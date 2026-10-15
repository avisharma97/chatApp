/**
 * One canonical origin allowlist for HTTP, Socket.IO, and origin protection.
 * WEB_ORIGIN accepts comma-separated origins, e.g. https://web.example.com.
 */
export function getAllowedOrigins(): string[] {
  const configured = (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WEB_ORIGIN must be configured in production");
    }
    return ["http://localhost:3000"];
  }

  const origins = configured.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid WEB_ORIGIN entry: ${value}`);
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error(`WEB_ORIGIN must contain origins only: ${value}`);
    }

    return parsed.origin;
  });

  return [...new Set(origins)];
}
