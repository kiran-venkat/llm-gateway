# Cache Module

Exact-match response cache using SHA-256 keyed Redis entries. Sits between `RateLimitGuard`
and the route handler, serving identical requests from Redis in <1ms.

## How it works

```
Incoming request
  → CacheInterceptor.intercept()
    → RouterService.resolve()          ← determines provider + model (attaches to req)
    → buildCacheKey(req)               ← SHA-256 hash of (tenant+provider+model+messages+params)
    → Redis GET tenant:{id}:cache:{hash}
      HIT  → res.json(cached) + enqueue usage job (cacheHit:true) + return of(null)
      MISS → attach cacheKey to req → next.handle() → response written to Redis via CacheJob
```

**Critical:** Use `of(null)` not `EMPTY` on cache hits. `EMPTY` completes the observable
without emission, which triggers `EmptyError` → request crashes. `of(null)` emits once then
completes normally — NestJS sees a completed observable and does not attempt further handling.

## Cache key (ADR-004)

`SHA-256(tenantId + provider + model + JSON.stringify(messages) + maxTokens + temperature)`

Redis key: `tenant:{id}:cache:{64-hex-chars}`

Tenant isolation is built into the key. Parameter sensitivity is complete — any change in
temperature, maxTokens, or message content produces a new key (cache miss).

See [ADR-004](../../../docs/decisions/ADR-004-cache-key-async-population.md).

## Async population window

`CacheJob` writes to Redis ~1–2s after the response is delivered (BullMQ async). During this
window, a repeated identical request is a cache miss. This is intentional — a synchronous
write would add Redis latency to every cacheable response. See ADR-004.

## Response IDs on cache hits

Fabricated as `gw-cached-{uuid}`. The `gw-cached-` prefix lets logs and dashboards
distinguish cache hits from live provider responses without inspecting headers.

## Headers set by CacheInterceptor

```
X-Cache-Hit: true | false
X-Cache-Type: exact
X-Gateway-Provider: openai | anthropic | gemini
X-Gateway-Model: <model-name>
X-Latency-Ms: <milliseconds>
```

## Skip conditions

- `x-no-cache: 1` header on the request
- Streaming requests (`stream: true` in body)

## Stats counters

`CacheService` maintains Redis counters at `tenant:{id}:cache:stats:{hits,misses,tokens_saved}`.
`GET /api/v1/analytics/cache` reads these. `top_entries` returns `[]` until `CacheJob` is
extended to write to the `cache_entries` DB table (future task).

## Key files

| File | Purpose |
|------|---------|
| `cache.interceptor.ts` | `NestInterceptor` — cache check, hit/miss routing |
| `cache.service.ts` | Redis get/set, stats increment, `getStats()` |
| `cache-key.util.ts` | `buildCacheKey()` — SHA-256 hash construction |
| `../usage/jobs/cache.job.ts` | BullMQ processor that writes response to Redis |

## Related ADRs

- [ADR-004](../../../docs/decisions/ADR-004-cache-key-async-population.md) — key design, async population, response ID prefix
- [ADR-002](../../../docs/decisions/ADR-002-async-bullmq-tail.md) — why CacheJob is enqueued async from UsageJob
