import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { authRateLimit } from "../src/middleware/auth-rate-limit.js";
import { authRouter } from "../src/routes/auth.routes.js";
import { requireTrustedOrigin } from "../src/middleware/require-origin.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(requireTrustedOrigin);
app.use("/api/v1/auth", authRouter);

describe("Authentication security", () => {
  it("rejects /me when no session cookie is present", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "UNAUTHENTICATED",
    });
  });

  it("clears the session cookie when logging out without a cookie", async () => {
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "http://localhost:3000");

    expect(response.status).toBe(204);

    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.join(";")).toContain("chatapp_session=");
    expect(setCookie.join(";")).toContain("HttpOnly");
  });

  it("rejects logout requests from an untrusted origin", async () => {
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "https://evil.example");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("blocks authentication attempts after the configured limit", async () => {
    const rateLimitApp = express();

    rateLimitApp.use(express.json());
    rateLimitApp.post("/login", authRateLimit, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    // Ten requests should be allowed.
    for (let i = 0; i < 10; i++) {
      const response = await request(rateLimitApp)
        .post("/login")
        .send({ email: `user${i}@example.com` });

      expect(response.status).toBe(200);
    }

    // The next request should be rate limited.
    const blockedResponse = await request(rateLimitApp)
      .post("/login")
      .send({ email: "blocked@example.com" });

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body.error).toBe("TOO_MANY_REQUESTS");
  });
});

it("rejects Google callback when the state cookie is missing", async () => {
  const response = await request(app).get(
    "/api/v1/auth/google/callback?code=fake-code&state=test-state",
  );

  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    error: "INVALID_OAUTH_STATE",
  });
});

it("rejects Google callback when state does not match", async () => {
  const response = await request(app)
    .get("/api/v1/auth/google/callback?code=fake-code&state=wrong-state")
    .set("Cookie", "chatapp_google_state=expected-state");

  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    error: "INVALID_OAUTH_STATE",
  });
});

it("handles Google login cancellation without exchanging a code", async () => {
  const state = "valid-test-state";

  const response = await request(app)
    .get(`/api/v1/auth/google/callback?state=${state}&error=access_denied`)
    .set("Cookie", `chatapp_google_state=${state}`);

  expect(response.status).toBe(401);
  expect(response.body).toEqual({
    error: "GOOGLE_LOGIN_CANCELLED",
  });
});
