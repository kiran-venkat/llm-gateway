# ADR-003: Redis Sliding-Window Rate Limiting via Lua Script

**Status:** Accepted  
**Date:** 2026-02-01  
**Deciders:** Core team

## Context

The gateway enforces two rate limits per tenant per provider:
- **RPM** — requests per minute (coarse; prevents abuse)
- **TPM** — tokens per minute (fine; prevents cost blowout)

Requirements:
- Atomic check-and-increment: no window where a request passes the check but the slot
  has already been consumed by a concurrent request
- No separate Redis calls for "check" and "increment" — race condition window between them
- Per-tenant, per-provider isolation (tenants don't share limits)
- Configurable limits stored in `provider_configs`, not hardcoded

An additional ordering constraint exists: token estimation (pure CPU arithmetic) must run
*before* any Redis call. If TPM would reject the request, an RPM slot must not be consumed.

## Decision

**Single Lua script executed atomically in Redis via `EVALSHA`.**

The script (`src/modules/rate-limit/sliding-window.lua`) uses a sorted set keyed by
`ratelimit:{tenantId}:{provider}:rpm|tpm`. It:
1. Removes members older than the window start (`ZREMRANGEBYSCORE ... -inf (now - 60000)`)
2. Counts remaining members (`ZCARD`)
3. If count < limit: adds current request (`ZADD`) and returns `[0, remaining]`
4. If count >= limit: returns `[1, 0]` without adding — slot not consumed

Everything happens inside one Redis command, eliminating the TOCTOU race.

Key format: `ratelimit:{tenantId}:{provider}:rpm` and `ratelimit:{tenantId}:{provider}:tpm`

**Guard ordering in `RateLimitGuard`:**
1. `estimateTokens()` — pure CPU, no Redis
2. `checkRpm()` — Redis call, consumes slot
3. Budget check — Redis GET (read-only)
4. `checkTpm()` — Redis call, uses token estimate from step 1

RPM slot is consumed before budget check as a deliberate signal that the request was
attempted. Budget check is read-only and placed between RPM and TPM so no token weight
is added for a request that will be rejected by budget.

## Consequences

**Good:**
- Zero race conditions — the sorted-set ZCARD + ZADD happen atomically
- Sliding window (not fixed window) prevents burst exploitation at window boundaries
- `ioredis-mock` executes Lua natively — unit tests use it directly, no real Redis needed
- `RateLimitResult.limit` carries the configured limit so controllers can set
  `X-RateLimit-Limit-Rpm` without a second DB lookup

**Watch out for:**
- `nest-cli.json` asset copy is unreliable for `.lua` files. The build script uses
  `find src -name '*.lua' | cp` instead. If you add more Lua scripts, update the build step.
- TPM is skipped gracefully if the adapter is not in the registry (new provider being set up).
- `estimateTokens()` must always run before `checkRpm()`. Do not reorder. See CLAUDE.md.

## Affected modules

- `src/modules/rate-limit/` — see [rate-limit CLAUDE.md](../../src/modules/rate-limit/CLAUDE.md)
- `src/modules/gateway/` — `RateLimitGuard` applied via `@UseGuards(AuthGuard, RateLimitGuard)`
