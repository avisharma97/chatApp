import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  AuthenticatedRequest,
  requireAuth,
} from "../middleware/require-auth.js";

export const conversationsRouter = Router();

const directSchema = z.object({
  userId: z.string().uuid(),
});

conversationsRouter.use(requireAuth);

// POST /api/v1/conversations/direct
conversationsRouter.post("/direct", async (req, res) => {
  const parsed = directSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const targetUserId = parsed.data.userId;

  const currentUserId = req.userId;

  if (!currentUserId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  try {
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, isActive: true },
      select: { id: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        type: "DIRECT",
        AND: [
          { members: { some: { userId: currentUserId } } },
          { members: { some: { userId: targetUserId } } },
        ],
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (existing) {
      return res.status(200).json({
        conversation: existing,
        created: false,
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        type: "DIRECT",
        members: {
          create: [{ userId: currentUserId }, { userId: targetUserId }],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return res.status(201).json({
      conversation,
      created: true,
    });
  } catch (error) {
    req.log?.error({ err: error }, "Create conversation failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// GET /api/v1/conversations
conversationsRouter.get("/", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            senderId: true,
            content: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conversation) => {
        const unreadCount = await prisma.messageReceipt.count({
          where: {
            userId,
            readAt: null,
            message: {
              conversationId: conversation.id,
              senderId: { not: userId },
            },
          },
        });

        const { messages, ...rest } = conversation;

        return {
          ...rest,
          latestMessage: messages[0] ?? null,
          unreadCount,
        };
      }),
    );

    return res.json({ conversations: conversationsWithUnread });
  } catch (error) {
    console.error("ACTUAL CONVERSATIONS ERROR:", error);
    req.log?.error({ err: error }, "List conversations failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// GET /api/v1/conversations/:conversationId/members
conversationsRouter.get("/:conversationId/members", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsedId = z.string().uuid().safeParse(req.params.conversationId);

  if (!parsedId.success) {
    return res.status(400).json({
      error: "INVALID_CONVERSATION_ID",
    });
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parsedId.data,
        members: { some: { userId } },
      },
      select: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        error: "CONVERSATION_NOT_FOUND",
      });
    }

    return res.json({ members: conversation.members });
  } catch (error) {
    req.log?.error({ err: error }, "Get members failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});
