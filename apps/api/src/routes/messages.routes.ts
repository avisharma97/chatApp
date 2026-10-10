import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getIO } from "../lib/socket.js";
export const messagesRouter = Router();

messagesRouter.use(requireAuth);

const sendMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
});

// POST /api/v1/conversations/:conversationId/messages
messagesRouter.post("/:conversationId/messages", async (req, res) => {
  const userId = req.userId;
  const conversationId = z.string().uuid().safeParse(req.params.conversationId);
  const body = sendMessageSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  if (!conversationId.success || !body.success) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: conversationId.data,
          userId,
        },
      },
      select: { userId: true },
    });

    if (!membership) {
      return res.status(404).json({
        error: "CONVERSATION_NOT_FOUND",
      });
    }

    // A retry with the same clientMessageId must not create a duplicate.
    const existing = await prisma.message.findFirst({
      where: {
        senderId: userId,
        clientMessageId: body.data.clientMessageId,
      },
    });

    if (existing) {
      return res.status(200).json({
        message: existing,
        duplicate: true,
      });
    }

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: conversationId.data,
          senderId: userId,
          clientMessageId: body.data.clientMessageId,
          content: body.data.content,
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          clientMessageId: true,
          content: true,
          createdAt: true,
          editedAt: true,
          deletedAt: true,
        },
      });
      const recipients = await tx.conversationMember.findMany({
        where: {
          conversationId: conversationId.data,
          userId: { not: userId },
        },
        select: { userId: true },
      });

      if (recipients.length > 0) {
        await tx.messageReceipt.createMany({
          data: recipients.map((recipient) => ({
            messageId: created.id,
            userId: recipient.userId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.conversation.update({
        where: { id: conversationId.data },
        data: { updatedAt: new Date() },
      });

      return created;
    });
    getIO()
      .to(`conversation:${conversationId.data}`)
      .emit("message:new", message);

    return res.status(201).json({
      message,
      duplicate: false,
    });
  } catch (error) {
    // Handle concurrent retries that race on the database unique constraint.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const existing = await prisma.message.findFirst({
        where: {
          senderId: userId,
          clientMessageId: body.data.clientMessageId,
        },
      });

      if (existing) {
        if (existing.conversationId !== conversationId.data) {
          return res.status(409).json({
            error: "CLIENT_MESSAGE_ID_ALREADY_USED",
          });
        }

        return res.status(200).json({
          message: existing,
          duplicate: true,
        });
      }
    }
    console.error("[POST message] Actual error:", error);
    req.log?.error({ err: error }, "Send message failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// GET /api/v1/conversations/:conversationId/messages?limit=20&cursor=<messageId>
messagesRouter.get("/:conversationId/messages", async (req, res) => {
  const userId = req.userId;
  const parsedConversationId = z
    .string()
    .uuid()
    .safeParse(req.params.conversationId);

  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().uuid().optional(),
    })
    .safeParse(req.query);

  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  if (!parsedConversationId.success || !query.success) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: parsedConversationId.data,
          userId,
        },
      },
      select: { userId: true },
    });

    if (!membership) {
      return res.status(404).json({
        error: "CONVERSATION_NOT_FOUND",
      });
    }

    if (query.data.cursor) {
      const cursorMessage = await prisma.message.findFirst({
        where: {
          id: query.data.cursor,
          conversationId: parsedConversationId.data,
        },
        select: { id: true },
      });

      if (!cursorMessage) {
        return res.status(400).json({
          error: "INVALID_CURSOR",
        });
      }
    }

    const rows = await prisma.message.findMany({
      where: {
        conversationId: parsedConversationId.data,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.data.limit + 1,
      ...(query.data.cursor
        ? {
            cursor: { id: query.data.cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        clientMessageId: true,
        content: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
        receipts: {
          select: {
            userId: true,
            deliveredAt: true,
            readAt: true,
          },
        },
      },
    });

    const hasMore = rows.length > query.data.limit;
    const page = rows.slice(0, query.data.limit);
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;

    return res.json({
      messages: page.reverse(),
      pagination: {
        limit: query.data.limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    req.log?.error({ err: error }, "List messages failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});
