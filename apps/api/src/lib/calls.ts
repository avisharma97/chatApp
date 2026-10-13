import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "./prisma.js";

type CallType = "audio" | "video";
type CallStatus = "ringing" | "accepted";

type CallSession = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  status: CallStatus;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
  acceptedAt: number | null;
};

type Ack = (result: { ok: boolean; error?: string; callId?: string }) => void;

const calls = new Map<string, CallSession>();
const activeCallByUser = new Map<string, string>();

// Initial per-process limit. Replace with a shared limiter
// before running multiple API instances.
const attempts = new Map<string, number[]>();

const RING_TIMEOUT_MS = 30_000;
const MAX_SIGNAL_BYTES = 24_000;
const MAX_CALLS_PER_MINUTE = 5;

const startSchema = z
  .object({
    conversationId: z.string().uuid(),
    type: z.enum(["audio", "video"]),
  })
  .strict();

const callIdSchema = z
  .object({
    callId: z.string().uuid(),
  })
  .strict();

const signalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      callId: z.string().uuid(),
      kind: z.literal("offer"),
      payload: z
        .object({
          type: z.literal("offer"),
          sdp: z.string().min(1).max(20_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      callId: z.string().uuid(),
      kind: z.literal("answer"),
      payload: z
        .object({
          type: z.literal("answer"),
          sdp: z.string().min(1).max(20_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      callId: z.string().uuid(),
      kind: z.literal("ice"),
      payload: z
        .object({
          candidate: z.string().min(1).max(4_096),
          sdpMid: z.string().max(256).nullable(),
          sdpMLineIndex: z.number().int().min(0).max(255).nullable(),
          usernameFragment: z.string().max(256).optional(),
        })
        .strict(),
    })
    .strict(),
]);

function ackError(ack?: Ack, error = "REQUEST_REJECTED") {
  ack?.({ ok: false, error });
}

function isParticipant(call: CallSession, userId: string) {
  return call.callerId === userId || call.calleeId === userId;
}

function otherParticipant(call: CallSession, userId: string) {
  return call.callerId === userId ? call.calleeId : call.callerId;
}

function consumeStartLimit(userId: string) {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter(
    (time) => now - time < 60_000,
  );

  if (recent.length >= MAX_CALLS_PER_MINUTE) {
    attempts.set(userId, recent);
    return false;
  }

  recent.push(now);
  attempts.set(userId, recent);
  return true;
}

function finishCall(
  io: Server,
  call: CallSession,
  reason: "rejected" | "ended" | "missed" | "unavailable",
) {
  if (!calls.has(call.id)) return;

  clearTimeout(call.timer);
  calls.delete(call.id);

  if (activeCallByUser.get(call.callerId) === call.id) {
    activeCallByUser.delete(call.callerId);
  }

  if (activeCallByUser.get(call.calleeId) === call.id) {
    activeCallByUser.delete(call.calleeId);
  }

  const statusMap = {
    rejected: "REJECTED",
    ended: "ENDED",
    missed: "MISSED",
    unavailable: "UNAVAILABLE",
  } as const;

  const endedAt = Date.now();
  const durationSeconds = call.acceptedAt
    ? Math.max(0, Math.floor((endedAt - call.acceptedAt) / 1000))
    : 0;

  // Persist history without blocking the Socket.IO notification.
  void prisma.callHistory
    .updateMany({
      where: {
        id: call.id,
        status: { in: ["RINGING", "ACCEPTED"] },
      },
      data: {
        status: statusMap[reason],
        endedAt: new Date(endedAt),
        durationSeconds,
      },
    })
    .catch((error: unknown) => {
      console.error("Failed to persist call history", error);
    });

  const event = {
    callId: call.id,
    conversationId: call.conversationId,
    reason,
  };

  io.to(`user:${call.callerId}`).emit("call:ended", event);
  io.to(`user:${call.calleeId}`).emit("call:ended", event);
}

export function registerCallHandlers(io: Server, socket: Socket) {
  const userId = socket.data.userId as string;

  socket.on("call:start", async (payload: unknown, ack?: Ack) => {
    const parsed = startSchema.safeParse(payload);

    if (!parsed.success) return ackError(ack, "INVALID_INPUT");
    if (!consumeStartLimit(userId)) {
      return ackError(ack, "RATE_LIMITED");
    }

    const { conversationId, type } = parsed.data;

    try {
      // Only direct conversations with exactly two members
      // are supported in this first version.
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
        take: 3,
      });

      if (
        members.length !== 2 ||
        !members.some((member) => member.userId === userId)
      ) {
        return ackError(ack, "CONVERSATION_NOT_FOUND");
      }

      const calleeId = members.find(
        (member) => member.userId !== userId,
      )!.userId;

      if (activeCallByUser.has(userId) || activeCallByUser.has(calleeId)) {
        return ackError(ack, "USER_BUSY");
      }

      // The recipient room is assigned by the server, not
      // supplied by the client.
      const recipientRoom = io.sockets.adapter.rooms.get(`user:${calleeId}`);

      if (!recipientRoom || recipientRoom.size === 0) {
        return ackError(ack, "USER_OFFLINE");
      }

      const callId = randomUUID();
      await prisma.callHistory.create({
        data: {
          id: callId,
          conversationId,
          callerId: userId,
          calleeId,
          type,
          status: "RINGING",
        },
      });
      const timer = setTimeout(() => {
        const current = calls.get(callId);
        if (current?.status === "ringing") {
          finishCall(io, current, "missed");
        }
      }, RING_TIMEOUT_MS);

      const call: CallSession = {
        id: callId,
        conversationId,
        callerId: userId,
        calleeId,
        type,
        status: "ringing",
        createdAt: Date.now(),
        timer,
        acceptedAt: null,
      };

      calls.set(callId, call);
      activeCallByUser.set(userId, callId);
      activeCallByUser.set(calleeId, callId);

      io.to(`user:${calleeId}`).emit("call:incoming", {
        callId,
        conversationId,
        type,
        callerId: userId,
      });

      ack?.({ ok: true, callId });
    } catch {
      ackError(ack, "INTERNAL_SERVER_ERROR");
    }
  });

  socket.on("call:accept", (payload: unknown, ack?: Ack) => {
    const parsed = callIdSchema.safeParse(payload);
    if (!parsed.success) return ackError(ack, "INVALID_INPUT");

    const call = calls.get(parsed.data.callId);

    if (!call || call.calleeId !== userId) {
      return ackError(ack, "CALL_NOT_FOUND");
    }
    if (call.status !== "ringing") {
      return ackError(ack, "INVALID_CALL_STATE");
    }

    clearTimeout(call.timer);
    call.status = "accepted";
    call.acceptedAt = Date.now();

    void prisma.callHistory
      .updateMany({
        where: {
          id: call.id,
          status: "RINGING",
        },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(call.acceptedAt),
        },
      })
      .catch((error: unknown) => {
        console.error("Failed to persist accepted call", error);
      });
    const event = {
      callId: call.id,
      conversationId: call.conversationId,
      type: call.type,
    };

    io.to(`user:${call.callerId}`).emit("call:accepted", event);
    io.to(`user:${call.calleeId}`).emit("call:accepted", event);

    ack?.({ ok: true, callId: call.id });
  });

  socket.on("call:reject", (payload: unknown, ack?: Ack) => {
    const parsed = callIdSchema.safeParse(payload);
    if (!parsed.success) return ackError(ack, "INVALID_INPUT");

    const call = calls.get(parsed.data.callId);
    if (!call || call.calleeId !== userId) {
      return ackError(ack, "CALL_NOT_FOUND");
    }

    finishCall(io, call, "rejected");
    ack?.({ ok: true });
  });

  socket.on("call:end", (payload: unknown, ack?: Ack) => {
    const parsed = callIdSchema.safeParse(payload);
    if (!parsed.success) return ackError(ack, "INVALID_INPUT");

    const call = calls.get(parsed.data.callId);
    if (!call || !isParticipant(call, userId)) {
      return ackError(ack, "CALL_NOT_FOUND");
    }

    finishCall(io, call, "ended");
    ack?.({ ok: true });
  });

  socket.on("call:signal", (payload: unknown, ack?: Ack) => {
    const parsed = signalSchema.safeParse(payload);
    if (!parsed.success) return ackError(ack, "INVALID_INPUT");

    const data = parsed.data;
    const call = calls.get(data.callId);

    if (!call || !isParticipant(call, userId)) {
      return ackError(ack, "CALL_NOT_FOUND");
    }
    if (call.status !== "accepted") {
      return ackError(ack, "CALL_NOT_ACCEPTED");
    }

    // Caller creates the offer; callee creates the answer.
    if (data.kind === "offer" && call.callerId !== userId) {
      return ackError(ack, "INVALID_SIGNAL_SENDER");
    }
    if (data.kind === "answer" && call.calleeId !== userId) {
      return ackError(ack, "INVALID_SIGNAL_SENDER");
    }

    if (
      Buffer.byteLength(JSON.stringify(data.payload), "utf8") > MAX_SIGNAL_BYTES
    ) {
      return ackError(ack, "SIGNAL_TOO_LARGE");
    }

    const recipientId = otherParticipant(call, userId);

    io.to(`user:${recipientId}`).emit("call:signal", {
      callId: call.id,
      kind: data.kind,
      payload: data.payload,
    });

    ack?.({ ok: true, callId: call.id });
  });

  socket.on("disconnect", () => {
    const callId = activeCallByUser.get(userId);
    if (!callId) return;

    const call = calls.get(callId);
    if (!call) return;

    // Don't immediately terminate a call if the user has another
    // active socket connection (e.g. another tab).
    const remainingSockets = io.sockets.adapter.rooms.get(`user:${userId}`);

    if (remainingSockets && remainingSockets.size > 1) return;

    finishCall(io, call, "unavailable");
  });
}
