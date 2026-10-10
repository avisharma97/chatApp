import type { Request, Response, NextFunction } from "express";
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function getAllowedOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Read-only requests do not need this Origin check.
  if (safeMethods.has(req.method)) {
    return next();
  }

  const origin = req.get("Origin");

  // Reject missing, malformed, or untrusted origins on mutations.
  if (!origin) {
    return res.status(403).json({
      error: "ORIGIN_REQUIRED",
    });
  }

  let normalizedOrigin: string;

  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return res.status(403).json({
      error: "INVALID_ORIGIN",
    });
  }

  if (!getAllowedOrigins().includes(normalizedOrigin)) {
    return res.status(403).json({
      error: "ORIGIN_NOT_ALLOWED",
    });
  }

  return next();
}
