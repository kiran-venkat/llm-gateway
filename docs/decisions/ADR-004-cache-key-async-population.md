# ADR-004: Cache Key Design and Async Population

**Status:** Accepted  
**Date:** 2026-02-10  
**Deciders:** Core team

## Context

LLM responses are expensive and deterministic for a given (provider, model, messages, params)
combination. Caching identical requests is high-value. Design questions:

1. **What forms the cache key?** The key must distinguish semantically different requests
   while collapsing semantically identical ones regardless of superficial differences.
2. **When is the cache written?** Synchronous write blocks the hot path. Async write
   means there's a window where a repeated request is a miss.
3. **How are cache hits distinguished in logs?** Response IDs from providers follow
   provider-specific formats; a cached response ID needs to be recognisable.

## Decision

**SHA-256 hash key, async BullMQ write, `gw-cached-` ID prefix.**

### Cache key

`SHA-256(tenantId + provider + model + JSON(messages) + maxTokens + temperature)`

Redis key: `tenant:{id}:cache:{64-hex-chars}`

Including `tenantId` ensures tenants never share cached responses (data isolation).
Including all inference parameters means a change in temperature or maxTokens correctly
produces a cache miss. JSON serialisation of messages is deterministic for equal inputs.

### Population

`CacheJob` is enqueued by `UsageJob` after the response is delivered (see ADR-002).
BullMQ processes it within ~1–2s. During this window a repeated identical request is a miss.

This trade-off is deliberate: a synchronous Redis write would add latency to every cacheable
response. The window is narrow and the worst case is one extra provider call per burst,
not a correctness failure.

### Response IDs on cache hits

`CacheInterceptor` fabricates an OpenAI-compatible response with ID `gw-cached-{uuid}`.
The `gw-cached-` prefix allows logs, dashboards, and downstream systems to distinguish
cache-served responses from live provider responses without inspecting headers.

### Headers set by `CacheInterceptor`

- `X-Cache-Hit: true|false`
- `X-Cache-Type: exact`
- `X-Gateway-Provider: <provider>`
- `X-Gateway-Model: <model>`
- `X-Latency-Ms: <ms>`

## Consequences

**Good:**
- Key is deterministic and collision-resistant (SHA-256, 256-bit)
- Tenant isolation is built into the key — no cross-tenant cache leakage
- ~2s population window is acceptable for analytics use cases
- `gw-cached-` prefix is a durable convention — document it for integrators

**Watch out for:**
- `CacheJob` currently writes only to Redis, not to the `cache_entries` DB table.
  `CacheService.getStats()` queries `cache_entries` for `top_entries`, which returns `[]`
  until that table is populated. This is known and intentional — a future task.
- `CacheInterceptor` uses `of(null)` not `EMPTY` on cache hits. `EMPTY` causes
  `EmptyError` that crashes the request. Do not change.
- `x-no-cache` header skips the interceptor entirely. Streaming requests are also skipped.

## Affected modules

- `src/modules/cache/` — see [cache CLAUDE.md](../../src/modules/cache/CLAUDE.md)
- `src/modules/usage/` — `CacheJob` is enqueued from `UsageJob` (ADR-002 dependency)
- `src/modules/gateway/` — `CacheInterceptor` sits between `RateLimitGuard` and the handler
