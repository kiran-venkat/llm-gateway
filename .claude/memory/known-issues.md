# Known Issues and Quirks

## 1. BullMQ MaxListenersExceededWarning in tests

**Symptom:** Node.js emits `MaxListenersExceededWarning: Possible EventEmitter memory leak detected` during the test suite run. Does not cause test failures — output is cosmetic noise.

**Cause:** Each test module that imports `BullModule` registers new event listeners on the shared `EventEmitter` backing the queue. When many test files run in the same Jest worker without fully tearing down the BullMQ module between tests, listener count exceeds Node's default threshold of 10.

**Workaround in use:** Tests that use BullMQ queues mock them with `getQueueToken()` and `jest.fn()` rather than instantiating real queues. This keeps listener count low for most suites.

**Correct fix (not yet applied):** Add `require('events').EventEmitter.defaultMaxListeners = 20` in a Jest `globalSetup` file, or add `afterEach(() => jest.clearAllMocks())` in suites that spin up real BullMQ workers. Not critical until test count grows further.

---

## 2. ~2s async cache population window

**Symptom:** Two identical requests sent within ~2 seconds of each other both miss the cache and hit the provider.

**Cause:** `CacheJob` is enqueued fire-and-forget after the provider response is delivered. BullMQ processes it within 1–2 seconds. During this window a second identical request finds no Redis key and is routed to the provider.

**This is intentional** — a synchronous Redis write on the hot path would add latency to every cacheable response. The window is narrow and the worst case is one extra provider call per burst, not a correctness failure.

**ADL reference:** "BullMQ CacheJob runs async — ~2s window where a repeated request is a miss" in CLAUDE.md.

**Fix if this becomes a problem:** Add a short TTL "pending" sentinel key to Redis synchronously (e.g. `SET tenant:{id}:cache:{hash}:pending 1 EX 10 NX`) so a second request can detect the in-flight write and either wait or skip. Not worth the complexity at current traffic levels.

---

## 3. cost_usd = 0 for models not in model_pricing

**Symptom:** `CostCalculatorService.calculateCost()` returns `0` and logs a warning for any model not found in the in-memory pricing Map. This means `totalCostUsd` in `requests` and `usage_daily` will be `0` for those rows, and budget checks will silently undercount spend.

**Cause:** `model_pricing` is seeded with 8 models (OpenAI/Anthropic/Gemini). Any model added by a provider after the last seed, or any model not in `scripts/seed-dev.ts`, falls through to `return 0`.

**Where to fix:** `src/modules/usage/cost-calculator.service.ts` — `onModuleInit()` loads pricing, `calculateCost()` does the Map lookup. `scripts/seed-dev.ts` is the source of truth for seeded prices.

**Action required when adding a new model:** Add a `modelPricing.upsert` row to `scripts/seed-dev.ts` AND to the production migration seed. Otherwise all requests using that model have `totalCostUsd = 0`.

---

## 4. top_entries in GET /analytics/cache always returns []

**Status:** Fixed in T57 (Sprint S1). `CacheJob` now calls `upsertEntry()` and `CacheInterceptor` calls `recordHit()`. `top_entries` returns real data in production.

**If you see [] again:** The `cache_entries` table is empty — either the seed was not run, or `CacheJob` is not processing. Check BullMQ worker logs and verify `cache_entries` has rows.

---

## 5. Gemini adapter uses string.includes() for error mapping

**Symptom:** `GeminiAdapter.mapError()` matches error types by checking `error.message.includes(...)` rather than using typed error classes.

**Cause:** The `@google/generative-ai` SDK does not expose structured error codes. Errors surface as plain `Error` objects with status codes embedded in the message string.

**Risk:** Google may change error message wording in a future SDK version, silently breaking the mapping. Monitor after SDK upgrades.

**ADL reference:** "GeminiAdapter mapError uses string.includes() not structured codes" in CLAUDE.md.

---

## 6. p95LatencyMs is stale intraday

**Symptom:** `GET /api/v1/analytics/latency` returns `null` for `p95LatencyMs` for the current day until 00:05 UTC the next day.

**Cause:** `DailyCloseJob` computes p95 once at midnight for the previous day. Intraday, the Redis sorted set accumulates samples but the `usage_daily` column is not updated until close.

**This is intentional.** See ADL: "DailyCloseJob owns p95 computation, not UsageJob." Acceptable for analytics dashboards. Not acceptable for real-time alerting — if real-time p95 is needed, read from the Redis sorted set directly.

---

## 7. TenantsRepository and RouterRepository intentionally do not extend BaseRepository

These two repositories bypass the mandatory `tenantId` scoping in `BaseRepository`. Both have documented reasons in the ADL:

- `TenantsRepository` — Tenant IS the root entity; it has no `tenantId` column.
- `RouterRepository` — Routing rules can be `tenantId = NULL` (global), requiring an OR query that BaseRepository cannot express.

Do not refactor these to extend BaseRepository. The test suite has coverage for both.
