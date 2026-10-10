import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";

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

  return res.status(200).json({ users });
});
