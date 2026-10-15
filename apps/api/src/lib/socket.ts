import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { registerCallHandlers } from "./calls.js";
import { getAllowedOrigins } from "./origins.js";
const require = createRequire(import.meta.url);
const cookie = require("cookie") as typeof import("cookie");
import { z } from "zod";
import { prisma } from "./prisma.js";

function getCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}
const onlineUsers = new Map<string, Set<string>>();
const COOKIE_NAME = "chatapp_session";

let io: Server | undefined;

export function initializeSocket(httpServer: HttpServer) {
  const allowedOrigins = getAllowedOrigins();
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // Authenticate every new Socket.IO connection.
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;

      if (!origin || !allowedOrigins.includes(origin)) {
        return next(new Error("ORIGIN_NOT_ALLOWED"));
      }

      const cookieHeader = socket.handshake.headers.cookie;
      const token = getCookieValue(
        socket.handshake.headers.cookie,
        COOKIE_NAME,
      );

      if (!token) {
        return next(new Error("UNAUTHENTICATED"));
      }

      const tokenHash = createHash("sha256").update(token).digest("hex");

      const session = await prisma.session.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          user: {
            select: { isActive: true },
          },
        },
      });

      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.user.isActive
      ) {
        return next(new Error("UNAUTHENTICATED"));
      }

      socket.data.userId = session.userId;
      socket.data.sessionId = session.id;
      return next();
    } catch {
      return next(new Error("AUTHENTICATION_FAILED"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const sessionId = socket.data.sessionId as string;

    // Handshake authentication alone is not enough: the session can be
    // revoked or expire while this socket remains connected. Validate each
    // client packet before its event handler is allowed to run.
    socket.use((_packet, next) => {
      void (async () => {
        try {
          const session = await prisma.session.findUnique({
            where: { id: sessionId },
            select: {
              userId: true,
              expiresAt: true,
              revokedAt: true,
              user: { select: { isActive: true } },
            },
          });

          if (
            !session ||
            session.userId !== userId ||
            session.revokedAt ||
            session.expiresAt <= new Date() ||
            !session.user.isActive
          ) {
            socket.disconnect(true);
            next(new Error("UNAUTHENTICATED"));
            return;
          }

          next();
        } catch {
          // Fail closed when the session store cannot be checked.
          socket.disconnect(true);
          next(new Error("AUTHENTICATION_UNAVAILABLE"));
        }
      })();
    });

    // Server-controlled rooms; clients cannot choose these identities.
    void socket.join(`user:${userId}`);
    void socket.join(`session:${sessionId}`);

    registerCallHandlers(io!, socket);
    const wasOffline = !onlineUsers.has(userId);

    if (wasOffline) {
      onlineUsers.set(userId, new Set());
    }

    onlineUsers.get(userId)!.add(socket.id);

    if (wasOffline) {
      socket.broadcast.emit("presence:update", {
        userId,
        isOnline: true,
      });
    }

    socket.emit("presence:initial", {
      onlineUserIds: [...onlineUsers.keys()],
    });
    socket.on(
      "conversation:join",
      async (payload: unknown, callback?: (result: object) => void) => {
        const parsed = z
          .object({
            conversationId: z.string().uuid(),
          })
          .safeParse(payload);

        if (!parsed.success) {
          callback?.({ ok: false, error: "INVALID_INPUT" });
          return;
        }

        try {
          const membership = await prisma.conversationMember.findUnique({
            where: {
              conversationId_userId: {
                conversationId: parsed.data.conversationId,
                userId: socket.data.userId as string,
              },
            },
            select: { userId: true },
          });

          if (!membership) {
            callback?.({ ok: false, error: "CONVERSATION_NOT_FOUND" });
            return;
          }

          await socket.join(`conversation:${parsed.data.conversationId}`);
          callback?.({ ok: true });
        } catch {
          callback?.({ ok: false, error: "INTERNAL_SERVER_ERROR" });
        }
      },
    );

    socket.on("conversation:leave", async (payload: unknown) => {
      const parsed = z
        .object({
          conversationId: z.string().uuid(),
        })
        .safeParse(payload);

      if (parsed.success) {
        await socket.leave(`conversation:${parsed.data.conversationId}`);
      }
    });

    socket.on(
      "typing:start",
      async (payload: unknown, callback?: (result: object) => void) => {
        const parsed = z
          .object({
            conversationId: z.string().uuid(),
          })
          .safeParse(payload);

        if (!parsed.success) {
          callback?.({ ok: false, error: "INVALID_INPUT" });
          return;
        }

        const userId = socket.data.userId as string;
        const conversationId = parsed.data.conversationId;

        try {
          const membership = await prisma.conversationMember.findUnique({
            where: {
              conversationId_userId: { conversationId, userId },
            },
            select: { userId: true },
          });

          if (!membership) {
            callback?.({ ok: false, error: "CONVERSATION_NOT_FOUND" });
            return;
          }

          // Only notify members in the conversation room.
          // Exclude the socket that started typing.
          socket
            .to(`conversation:${conversationId}`)
            .emit("typing:update", { conversationId, userId, isTyping: true });

          callback?.({ ok: true });
        } catch {
          callback?.({ ok: false, error: "INTERNAL_SERVER_ERROR" });
        }
      },
    );

    socket.on("typing:stop", async (payload: unknown) => {
      const parsed = z
        .object({
          conversationId: z.string().uuid(),
        })
        .safeParse(payload);

      if (!parsed.success) return;

      const userId = socket.data.userId as string;
      const conversationId = parsed.data.conversationId;

      try {
        const membership = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: { conversationId, userId },
          },
          select: { userId: true },
        });

        if (!membership) return;

        socket
          .to(`conversation:${conversationId}`)
          .emit("typing:update", { conversationId, userId, isTyping: false });
      } catch {
        // Typing status is best-effort; don't interrupt messaging.
      }
    });

    socket.on(
      "message:delivered",
      async (payload: unknown, callback?: (result: object) => void) => {
        const parsed = z
          .object({
            messageId: z.string().uuid(),
          })
          .safeParse(payload);

        if (!parsed.success) {
          callback?.({ ok: false, error: "INVALID_INPUT" });
          return;
        }

        const userId = socket.data.userId as string;

        try {
          const receipt = await prisma.messageReceipt.findUnique({
            where: {
              messageId_userId: {
                messageId: parsed.data.messageId,
                userId,
              },
            },
            include: {
              message: {
                select: {
                  conversationId: true,
                  senderId: true,
                },
              },
            },
          });

          if (!receipt) {
            callback?.({ ok: false, error: "RECEIPT_NOT_FOUND" });
            return;
          }

          const updated = await prisma.messageReceipt.update({
            where: {
              messageId_userId: {
                messageId: parsed.data.messageId,
                userId: socket.data.userId,
              },
            },
            data: {
              deliveredAt: receipt.deliveredAt ?? new Date(),
            },
          });

          const event = {
            messageId: parsed.data.messageId,
            userId,
            deliveredAt: updated.deliveredAt,
            readAt: updated.readAt,
          };

          io!
            .to(`conversation:${receipt.message.conversationId}`)
            .emit("message:receipt", event);

          callback?.({ ok: true });
        } catch {
          callback?.({ ok: false, error: "INTERNAL_SERVER_ERROR" });
        }
      },
    );

    socket.on(
      "conversation:read",
      async (payload: unknown, callback?: (result: object) => void) => {
        const parsed = z
          .object({
            conversationId: z.string().uuid(),
          })
          .safeParse(payload);

        if (!parsed.success) {
          callback?.({ ok: false, error: "INVALID_INPUT" });
          return;
        }

        const userId = socket.data.userId as string;
        const conversationId = parsed.data.conversationId;

        try {
          const membership = await prisma.conversationMember.findUnique({
            where: {
              conversationId_userId: { conversationId, userId },
            },
            select: { userId: true },
          });

          if (!membership) {
            callback?.({ ok: false, error: "CONVERSATION_NOT_FOUND" });
            return;
          }

          const pending = await prisma.messageReceipt.findMany({
            where: {
              userId,
              readAt: null,
              message: {
                conversationId,
                senderId: { not: userId },
              },
            },
            select: { messageId: true },
          });

          const readAt = new Date();

          if (pending.length > 0) {
            await prisma.messageReceipt.updateMany({
              where: {
                userId,
                messageId: { in: pending.map((item) => item.messageId) },
                readAt: null,
              },
              data: { deliveredAt: readAt, readAt },
            });

            for (const item of pending) {
              io!.to(`conversation:${conversationId}`).emit("message:receipt", {
                messageId: item.messageId,
                userId,
                deliveredAt: readAt,
                readAt,
              });
            }
          }

          await prisma.conversationMember.update({
            where: {
              conversationId_userId: { conversationId, userId },
            },
            data: { lastReadAt: readAt },
          });

          callback?.({ ok: true });
        } catch {
          callback?.({ ok: false, error: "INTERNAL_SERVER_ERROR" });
        }
      },
    );
    socket.on("disconnect", () => {
      const userId = socket.data.userId as string;
      const connections = onlineUsers.get(userId);

      if (!connections) return;

      connections.delete(socket.id);

      if (connections.size === 0) {
        onlineUsers.delete(userId);

        socket.broadcast.emit("presence:update", {
          userId,
          isOnline: false,
        });
      }
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.IO has not been initialized");
  }

  return io;
}

export function disconnectSessionSockets(sessionId: string): void {
  if (!io) return;

  io.in(`session:${sessionId}`).disconnectSockets(true);
}

export function disconnectUserSockets(userId: string): void {
  if (!io) return;

  io.in(`user:${userId}`).disconnectSockets(true);
}
