# ChatApp security hardening patch (single Render API instance)

This patch is based on the uploaded source bundle dated 2026-10-15. It does NOT edit your local repository automatically. Apply from the repository root after reviewing your working tree.

## Scope
- One canonical origin allowlist shared by Express CORS, Socket.IO CORS/handshake checks, and unsafe-method origin checks.
- Reject production startup when WEB_ORIGIN is absent/invalid; no silent localhost fallback in production.
- Revalidate the session on every inbound Socket.IO packet; disconnect sockets when the session expires, is revoked, or the account is inactive. This closes the stale-socket gap for a single API instance.
- Periodically prune expired in-memory call-rate-limit entries.

## Apply
1. Commit/stash or back up your current changes first; do not discard existing edits.
2. From the repo root, run `git apply --check .\security-hardening.patch` after copying the patch file to the repo root.
3. If check passes, run `git apply .\security-hardening.patch`.
4. Run the verification commands below.

## Environment
Render API:
- `NODE_ENV=production`
- `WEB_ORIGIN=https://chatapp-pi-jet.vercel.app` (comma-separated origins supported, no paths)
- Existing `DATABASE_URL`, `PORT`, Cloudinary and email/OAuth variables as already required by the app.

No Redis dependency is added because Redis is not confirmed available and the API currently runs one instance. The in-memory call reservation and auth rate limiter are therefore still single-instance only. Before enabling Render autoscaling/multiple API instances, add shared Redis-backed rate limiting, Socket.IO Redis adapter, and distributed atomic call reservations.

## Verification (PowerShell, repository root)
```powershell
pnpm --filter @chatapp/api typecheck
pnpm --filter @chatapp/api test
pnpm --filter @chatapp/api build
pnpm --filter @chatapp/web lint
pnpm --filter @chatapp/web build
```

## Manual regression checks
- Log in in two tabs; logout in one; the other socket must be disconnected or have all subsequent event packets rejected and disconnected.
- Reset password; all existing sockets for that user must stop processing events.
- Wait for session expiry in a test environment; next socket event must be rejected and disconnect the socket.
- Configure `WEB_ORIGIN` with two comma-separated origins and verify both allowed origins work for HTTP and Socket.IO; an untrusted origin and a missing Origin on a mutation must fail.
- Confirm health endpoints still work and message send/receive, read receipts, typing, and calls still work for an active session.

## Important limitations
The uploaded bundle did not include `apps/api/package.json` or `apps/api/prisma/schema.prisma`, so this patch deliberately does not invent a Prisma migration for unique direct-conversation pairs. Concurrent duplicate direct-conversation creation needs a canonical pair key plus a database uniqueness constraint and migration, designed against the actual schema. The patch also cannot be called a complete app-wide security audit: run tests and inspect live deployment configuration before release.
