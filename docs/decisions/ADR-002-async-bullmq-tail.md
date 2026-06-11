# ADR-002: Async BullMQ Tail for Post-Response Work

**Status:** Accepted  
**Date:** 2026-01-20  
**Deciders:** Core team

## Context

After delivering an LLM response, the gateway must:
1. Record the request in the DB (`requests` table)
2. Upsert aggregated daily usage (`usage_daily`)
3. Check and update the tenant's budget-exceeded flag (Redis)
4. Optionally write the response to the Redis cache

All of this is bookkeeping — the client doesn't need it before receiving their response.
Doing it synchronously would add 50–200ms of DB/Redis latency to every hot-path request.

For streaming responses, there's an additional constraint: the work can only start *after*
the last SSE chunk has been flushed, not before. And once the 200 OK + SSE headers are sent,
the HTTP status code cannot be changed — a mid-stream DB failure must not affect the stream.

## Decision

**Fire-and-forget BullMQ jobs after the response is delivered.**

`StreamService.proxy()` calls `res.end()` first, then immediately calls `onComplete()`.
`onComplete()` calls `GatewayService.enqueueUsageJob()` which enqueues a `UsageJob` into
the `'usage'` BullMQ queue.

`UsageJob` runs the full post-response sequence atomically:
1. Recalculate cost (in-memory, from `CostCalculatorService`)
2. `UsageRepository.createRequest()` — insert into `requests`
3. `UsageRepository.upsertDailyUsage()` — atomic `INSERT ... ON CONFLICT DO UPDATE`
4. `BudgetCheckerService.check()` — set Redis exceeded flag if threshold crossed
5. `CacheJob` — write response to Redis if cacheable

Jobs are configured with `{ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`.

## Consequences

**Good:**
- Zero DB/Redis latency added to the client response path
- Streaming responses are never delayed or interrupted by bookkeeping failures
- BullMQ retries handle transient DB failures without data loss
- Cache population is also async — consistent model for all post-response work

**Watch out for:**
- ~2s window between response delivery and cache write. During this window a repeated
  identical request is a cache miss. This is deliberate — see ADR-004.
- `onComplete()` must always be called after `res.end()`, never before. See `StreamService`.
- `UsageJob` steps are order-dependent: `upsertDailyUsage` must run before `checkBudget`
  so the current request's cost is included in the budget aggregate query.
- Non-streaming path: `GatewayService.complete()` also enqueues via the same path.

## Affected modules

- `src/modules/stream/` — `proxy()` owns the res.end() → onComplete() ordering
- `src/modules/usage/` — `UsageJob`, `UsageRepository`, `BudgetCheckerService`
- `src/modules/cache/` — `CacheJob` is enqueued from within `UsageJob`
- `src/modules/gateway/` — see [gateway CLAUDE.md](../../src/modules/gateway/CLAUDE.md)
