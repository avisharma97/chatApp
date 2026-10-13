import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";

export const callsRouter = Router();

callsRouter.use(requireAuth);

callsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }

    const query = z
      .object({
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .safeParse(req.query);

    if (!query.success) {
      res.status(400).json({ error: "INVALID_QUERY" });
      return;
    }

    const { cursor, limit } = query.data;

    const rows = await prisma.callHistory.findMany({
      where: {
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        caller: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
        callee: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    res.json({
      calls: items.map((call) => {
        const incoming = call.calleeId === userId;
        const otherUser = incoming ? call.caller : call.callee;

        return {
          id: call.id,
          conversationId: call.conversationId,
          type: call.type,
          status: call.status,
          direction: incoming ? "INCOMING" : "OUTGOING",
          result:
            call.status === "MISSED" ||
            call.status === "UNAVAILABLE" ||
            call.status === "REJECTED"
              ? call.status
              : "COMPLETED_OR_ENDED",
          startedAt: call.startedAt,
          acceptedAt: call.acceptedAt,
          endedAt: call.endedAt,
          durationSeconds: call.durationSeconds,
          otherUser,
        };
      }),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    });
  } catch (error) {
    next(error);
  }
});
