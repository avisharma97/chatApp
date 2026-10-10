import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

export type AuthenticatedRequest = Request & {
  userId: string;
};

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.chatapp_session as string | undefined;

  if (!token) {
    return res.status(401).json({
      error: "UNAUTHENTICATED",
    });
  }

  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
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
      return res.status(401).json({
        error: "UNAUTHENTICATED",
      });
    }

    req.userId = session.userId;
    return next();
  } catch (error) {
    req.log?.error({ err: error }, "Authentication middleware failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}
