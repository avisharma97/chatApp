import dotenv from "dotenv";
import { resolve } from "node:path";
import { authRouter } from "./routes/auth.routes.js";
import { createServer } from "node:http";
import { initializeSocket, getIO } from "./lib/socket.js";
import { callsRouter } from "./routes/calls.routes.js";
dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});
import { uploadsRouter } from "./routes/uploads.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { messagesRouter } from "./routes/messages.routes.js";
import cookieParser from "cookie-parser";
import { requireTrustedOrigin } from "./middleware/require-origin.js";
import express from "express";
import pino from "pino";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "./lib/prisma.js";
import { z } from "zod";
import cors from "cors";
import type { IncomingMessage, ServerResponse } from "node:http";
import { conversationsRouter } from "./routes/conversations.routes.js";

const require = createRequire(import.meta.url);
const pinoHttp = require("pino-http") as typeof import("pino-http").default;

const config = z
  .object({
    API_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(Number(process.env.PORT ?? 4000)),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .parse(process.env);

const logger = pino({
  level: config.NODE_ENV === "production" ? "info" : "debug",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers['set-cookie']",
  ],
});

const app = express();

app.set("trust proxy", 1);

app.disable("x-powered-by");

// Allow requests from the Next.js frontend.
// Credentials are required for HttpOnly cookie authentication.
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Request-ID"],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(requireTrustedOrigin);

app.use(
  pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incomingId = req.headers["x-request-id"];

      const id =
        typeof incomingId === "string" &&
        /^[a-zA-Z0-9-]{1,64}$/.test(incomingId)
          ? incomingId
          : randomUUID();

      res.setHeader("x-request-id", id);
      return id;
    },
  }),
);

app.use("/api/v1/conversations", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
app.get("/health/live", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "chatapp-api",
  });
});
app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      service: "chatapp-api",
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "unavailable",
    });
  }
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/conversations", conversationsRouter);
app.use("/api/v1/conversations", messagesRouter);
app.use("/api/v1/conversations", uploadsRouter);
app.use("/api/v1/calls", callsRouter);

const server = createServer(app);

initializeSocket(server);

server.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, "ChatApp API started");
});

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Graceful shutdown started");

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);

  forceExit.unref();

  try {
    // Stop accepting new HTTP connections and wait for active requests.
    await new Promise<void>((resolve, reject) => {
      getIO().close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await prisma.$disconnect();

    logger.info("Graceful shutdown completed");
    clearTimeout(forceExit);
    process.exitCode = 0;
  } catch (error) {
    logger.error({ err: error }, "Graceful shutdown failed");
    clearTimeout(forceExit);
    process.exitCode = 1;
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
