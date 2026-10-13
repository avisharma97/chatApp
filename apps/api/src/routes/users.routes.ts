import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/", async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  if (search.length < 2) {
    return res.status(400).json({
      error: "INVALID_SEARCH",
      message: "Search must contain at least 2 characters.",
    });
  }

  if (search.length > 50) {
    return res.status(400).json({
      error: "INVALID_SEARCH",
      message: "Search cannot exceed 50 characters.",
    });
  }

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: req.userId },
      OR: [
        {
          username: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          displayName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
    orderBy: {
      username: "asc",
    },
    take: 10,
  });
  res.setHeader("Cache-Control", "no-store");

  return res.status(200).json({ users });
});

const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    username: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/),
  })
  .strict();

usersRouter.patch("/me", async (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  const parsed = updateProfileSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PROFILE",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        displayName: parsed.data.displayName,
        username: parsed.data.username,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    return res.json({ user });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "USERNAME_ALREADY_EXISTS",
      });
    }

    next(error);
  }
});
