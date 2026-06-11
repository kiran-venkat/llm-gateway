# Rate Limit Module

Enforces per-tenant, per-provider RPM and TPM limits using a Redis sliding-window Lua
script. Runs as a NestJS guard applied to `GatewayController`.

## How it works

`RateLimitGuard` runs after `AuthGuard` (needs `req.tenant`) in this order:

```
1. estimateTokens()     pure CPU — char count / 4, no Redis
2. checkRpm()           Redis EVALSHA — atomic check + increment sliding window
3. budget GET           Redis GET tenant:{id}:budget:exceeded → 402 if present
4. checkTpm()           Redis EVALSHA — uses token estimate from step 1
```

**This order is load-bearing.** `estimateTokens` must run before any Redis call — if TPM
would reject the request, an RPM slot must not be consumed first. Budget check is read-only
and placed between RPM and TPM so no token weight is added for a rejected request.

See [ADR-003](../../../docs/decisions/ADR-003-redis-sliding-window-rate-limit.md).

## Lua script

`sliding-window.lua` is a sorted-set sliding window:
1. `ZREMRANGEBYSCORE` removes members older than `now - 60000ms`
2. `ZCARD` counts remaining
3. If count < limit: `ZADD` current request, return `[0, remaining]`
4. If count >= limit: return `[1, 0]` — slot NOT consumed

Everything happens atomically in one Redis eval — no TOCTOU race between check and increment.

Key format: `ratelimit:{tenantId}:{provider}:rpm` and `ratelimit:{tenantId}:{provider}:tpm`

**Build note:** `nest-cli.json` asset copy is unreliable for `.lua` files. The build script
uses `find src -name '*.lua' | cp`. If you add more Lua scripts, update `package.json build`.

## Response headers (on every request)

```
X-RateLimit-Limit-Rpm: <configured limit>
X-RateLimit-Remaining-Rpm: <remaining slots>
X-RateLimit-Limit-Tpm: <configured limit>
X-RateLimit-Remaining-Tpm: <remaining tokens>
```

`RateLimitResult.limit` carries the configured limit so the controller can set the header
without a second DB lookup per request.

## Error responses

- `429 Too Many Requests` — RPM or TPM exceeded
  ```json
  { "error": "rate_limit_exceeded", "retry_after_ms": 60000, "limit_type": "rpm" }
  ```
  + `Retry-After: 60` header (set by `GlobalExceptionFilter`)

- `402 Payment Required` — monthly budget exceeded
  ```json
  { "error": "budget_exceeded" }
  ```

## TPM graceful skip

If the adapter is not found in `AdapterRegistry` (e.g. new provider being set up), TPM is
skipped silently — `estimateTokens()` returns 0 and `checkTpm()` is not called. This prevents
guard failures during provider onboarding.

## Key files

| File | Purpose |
|------|---------|
| `rate-limit.service.ts` | `runScript()`, `checkRpm()`, `checkTpm()`, `getRemainingRpm()` |
| `sliding-window.lua` | Atomic Redis Lua script |
| `src/common/guards/rate-limit.guard.ts` | NestJS guard — orchestrates the 4-step check |
| `src/common/interfaces/rate-limit-result.interface.ts` | `{ allowed, remaining, limit, retryAfterMs }` |

## Related ADRs

- [ADR-003](../../../docs/decisions/ADR-003-redis-sliding-window-rate-limit.md) — full design rationale, guard ordering, Lua script
- [ADR-001](../../../docs/decisions/ADR-001-provider-adapter-pattern.md) — `estimateTokens()` comes from `IProviderAdapter`
