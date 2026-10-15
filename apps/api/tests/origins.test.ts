import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllowedOrigins } from "../src/lib/origins.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAllowedOrigins", () => {
  it("normalizes and deduplicates configured origins", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "WEB_ORIGIN",
      "https://chatapp.example.com, https://chatapp.example.com",
    );

    expect(getAllowedOrigins()).toEqual(["https://chatapp.example.com"]);
  });

  it("uses localhost only outside production when unset", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WEB_ORIGIN", "");

    expect(getAllowedOrigins()).toEqual(["http://localhost:3000"]);
  });

  it("fails closed when production has no configured origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_ORIGIN", "");

    expect(() => getAllowedOrigins()).toThrow(/WEB_ORIGIN must be configured/);
  });

  it("rejects paths instead of silently widening them to an origin", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WEB_ORIGIN", "https://chatapp.example.com/some-path");

    expect(() => getAllowedOrigins()).toThrow(/origins only/);
  });
});
