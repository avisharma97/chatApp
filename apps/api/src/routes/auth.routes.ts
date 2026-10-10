import { Router } from "express";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRateLimit } from "../middleware/auth-rate-limit.js";
import { OAuth2Client } from "google-auth-library";
import { timingSafeEqual } from "node:crypto";

export const authRouter = Router();

const COOKIE_NAME = "chatapp_session";
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS,
  });
}

authRouter.use(cookieParser());

authRouter.post("/register", authRateLimit, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_INPUT",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const { email, username, displayName, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_MS);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          username,
          displayName,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          createdAt: true,
        },
      });

      await tx.session.create({
        data: {
          userId: createdUser.id,
          tokenHash,
          expiresAt,
        },
      });

      return createdUser;
    });

    setSessionCookie(res, token);

    return res.status(201).json({ user });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "EMAIL_OR_USERNAME_ALREADY_EXISTS",
      });
    }

    req.log?.error({ err: error }, "Registration failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

authRouter.post("/login", authRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Keep the response generic so we don't reveal whether an email exists.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        error: "INVALID_CREDENTIALS",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "ACCOUNT_DISABLED" });
    }

    const token = randomBytes(32).toString("base64url");

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });

    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    req.log?.error({ err: error }, "Login failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

const GOOGLE_STATE_COOKIE = "chatapp_google_state";
const GOOGLE_STATE_MAX_AGE = 10 * 60 * 1000;

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth environment variables are missing");
  }

  return { clientId, clientSecret, redirectUri };
}

function getGoogleClient() {
  const config = getGoogleConfig();

  return new OAuth2Client(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

function clearGoogleStateCookie(res: import("express").Response) {
  res.clearCookie(GOOGLE_STATE_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth/google",
  });
}

function safeStateMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function frontendUrl() {
  const configured = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  return new URL(configured.split(",")[0].trim());
}

// Start Google OAuth.
authRouter.get("/google", (_req, res) => {
  try {
    const client = getGoogleClient();
    const state = randomBytes(32).toString("base64url");

    res.cookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth/google",
      maxAge: GOOGLE_STATE_MAX_AGE,
    });

    const url = client.generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state,
      prompt: "select_account",
    });

    return res.redirect(url);
  } catch (error) {
    res.clearCookie(GOOGLE_STATE_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth/google",
    });

    return res.status(500).json({
      error: "GOOGLE_OAUTH_NOT_CONFIGURED",
    });
  }
});

// Google redirects the browser back here.
authRouter.get("/google/callback", async (req, res) => {
  const stateCookie = req.cookies?.[GOOGLE_STATE_COOKIE];
  const queryState = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const googleError =
    typeof req.query.error === "string" ? req.query.error : "";

  clearGoogleStateCookie(res);

  if (!stateCookie || !queryState || !safeStateMatch(stateCookie, queryState)) {
    return res.status(400).json({ error: "INVALID_OAUTH_STATE" });
  }

  if (googleError || !code) {
    return res.status(401).json({ error: "GOOGLE_LOGIN_CANCELLED" });
  }

  try {
    const config = getGoogleConfig();
    const client = getGoogleClient();

    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      return res.status(401).json({
        error: "GOOGLE_ID_TOKEN_MISSING",
      });
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.clientId,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({
        error: "GOOGLE_IDENTITY_NOT_VERIFIED",
      });
    }

    const providerUserId = payload.sub;
    const email = payload.email.trim().toLowerCase();

    const identity = await prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: "google",
          providerUserId,
        },
      },
      include: { user: true },
    });

    let user = identity?.user;

    if (!user) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUser) {
        return res.status(409).json({
          error: "ACCOUNT_LINK_REQUIRED",
          message:
            "This email already has an account. Sign in using that account before linking Google.",
        });
      }

      const emailPrefix = (email.split("@")[0] ?? "googleuser")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 18);

      const username = `${emailPrefix.length >= 3 ? emailPrefix : "googleuser"}_${randomBytes(4).toString("hex")}`;

      // This random hash is not a usable password known to the user.
      const passwordHash = await bcrypt.hash(
        randomBytes(32).toString("base64url"),
        12,
      );

      user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email,
            username,
            displayName: (payload.name ?? emailPrefix).slice(0, 80),
            passwordHash,
            avatarUrl: payload.picture ?? null,
          },
        });

        await tx.userIdentity.create({
          data: {
            userId: createdUser.id,
            provider: "google",
            providerUserId,
            email,
          },
        });

        return createdUser;
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "ACCOUNT_DISABLED" });
    }

    const token = randomBytes(32).toString("base64url");

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });

    setSessionCookie(res, token);

    const destination = frontendUrl();
    destination.searchParams.set("auth", "google_success");

    return res.redirect(destination.toString());
  } catch (error) {
    req.log?.error({ err: error }, "Google OAuth callback failed");

    return res.status(500).json({
      error: "GOOGLE_LOGIN_FAILED",
    });
  }
});

authRouter.get("/me", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;

  if (!token) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }

    return res.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        username: session.user.username,
        displayName: session.user.displayName,
        createdAt: session.user.createdAt,
      },
    });
  } catch (error) {
    req.log?.error({ err: error }, "Session verification failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;

  try {
    if (token) {
      await prisma.session.updateMany({
        where: {
          tokenHash: hashToken(token),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.status(204).end();
  } catch (error) {
    req.log?.error({ err: error }, "Logout failed");

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});
