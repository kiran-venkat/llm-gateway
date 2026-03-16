# LLM Gateway — Project Index

## CURRENT STATE
Last session ended: Phase 7 COMPLETE — T39–T42 done
Next task: T43 (Phase 8 start)
Tests: 457
Branch: dev

## What We Are Building
Production-grade API gateway between applications and LLM providers (OpenAI, Anthropic, Gemini).
Handles: auth, rate limiting, caching, routing, streaming, cost tracking.

## Stack
NestJS + TypeScript strict, Prisma, PostgreSQL + pgvector, Redis, BullMQ

## Architecture (one line per layer)
Request -> RequestIdMiddleware -> AuthGuard -> RateLimitGuard -> CacheInterceptor -> RouterService -> AdapterRegistry -> StreamService -> BullMQ async tail

## Key Patterns
- Multi-tenancy: shared DB, tenant_id on every table, base repo enforces scoping
- Providers: plugin/adapter pattern, AdapterRegistry maps name to IProviderAdapter
- Rate limiting: Redis sliding window via Lua script, atomic check + increment
- Caching: SHA-256(tenant+provider+model+messages+params) -> Redis exact match
- Async tail: BullMQ for all DB writes after stream ends, never block hot path

## Current Phase
Update this line at end of every session: "Completed T[X], next is T[X+1]"

## Reference Docs
- Architecture + decisions: .claude/docs/architecture.md
- Data models all 8 tables: .claude/docs/data-models.md
- API contracts: .claude/docs/api-contracts.md
- Module specs: .claude/docs/module-specs.md
- Task breakdown: .claude/docs/tasks.md
- Spikes: .claude/docs/spikes.md

## Code Rules (always apply)
- No any type ever
- No console.log, use NestJS Logger
- Every DB query must have tenantId scoping
- Every Redis key prefixed with tenant:{id}:
- Raw API keys never stored, hash ours, encrypt provider keys with AES-256-GCM
- Errors: typed domain exceptions, global exception filter formats them
- Commits: feat(module): description


## CODEBASE MAP

### Where things live
- Entry point:          src/main.ts
- Root module:          src/app.module.ts
- All interfaces:       src/common/interfaces/
- All shared utils:     src/common/utils/
- DB base class:        src/common/repositories/base.repository.ts
- Exception filter:     src/common/filters/global-exception.filter.ts
- Request ID:           src/common/middleware/request-id.middleware.ts
- Config service:       src/config/config.service.ts

### Module pattern (every module follows this)
src/modules/<name>/
  <name>.module.ts       ← NestJS module, wires DI
  <name>.service.ts      ← business logic, no Prisma here
  <name>.repository.ts   ← all DB access, extends BaseRepository
  <name>.controller.ts   ← HTTP layer only, no business logic

### Key interfaces
- IProviderAdapter:     src/common/interfaces/provider-adapter.interface.ts
- AuthContext:          src/common/interfaces/auth-context.interface.ts
- GatewayRequest:       src/common/dto/gateway-request.dto.ts
- GatewayResponse:      src/common/dto/gateway-response.dto.ts

### Current task progress
Phase 0: COMPLETE (T01-T06)
Phase 1: COMPLETE (T07-T11)
Phase 2: COMPLETE (T12-T18)
Phase 3: COMPLETE (T19-T23)
Phase 4: COMPLETE (T24-T28)
Phase 5: COMPLETE (T29-T33)
Phase 6: COMPLETE (T34-T38)
Phase 7: COMPLETE (T39-T42)
Phase 8: IN PROGRESS — T43 next

---

## Architectural Decisions Log

### TenantsRepository does not extend BaseRepository
Date: Phase 1, T07
Reason: Tenant is the root entity — it has no tenant_id column because
it IS the tenant. BaseRepository's scoping logic would generate
WHERE id = $1 AND tenant_id = $2 which is invalid on this table.
TenantsRepository uses the same PrismaDelegate<T> pattern but without
tenant scoping. This is correct and intentional — do not refactor.

All other repositories (api_keys, requests, usage_daily, etc.)
extend BaseRepository and require tenantId on every call.

### AnthropicAdapter extracts system messages to top-level param
Date: Phase 2, T15
Reason: Anthropic's API does not accept system messages inside the
messages[] array. They must be passed as a separate top-level `system`
string. The adapter uses `.find()` to pick the FIRST system message
(not the last), strips all system messages from the array, and passes
that string as the top-level `system` param before calling the SDK.
Do not change `.find()` to `.findLast()` — the current behavior is
intentional and the tests are written against it.

### GeminiAdapter enforces alternating turn order
Date: Phase 2, T16
Reason: Gemini's API requires strictly alternating user/model turns —
consecutive same-role messages cause a 400 error. The adapter inserts
empty filler messages between consecutive same-role messages.
translateMessages() is public to allow direct unit testing of this logic.

### RouterRepository does not extend BaseRepository
Date: Phase 3, T19
Reason: Routing rules can be global (tenantId = NULL) or tenant-specific.
The query needs OR [{ tenantId }, { tenantId: null }] which BaseRepository's
mandatory tenantId scoping cannot express. RouterRepository uses raw Prisma
directly and is the only repo with a NULL-aware query. Do not refactor.

### StreamService.onComplete fires after res.end()
Date: Phase 3, T22
Reason: The client must receive their complete SSE stream before any
blocking work (BullMQ enqueue, DB writes) happens. proxy() calls res.end()
first, then immediately calls onComplete(). This guarantees the hot path
is never blocked by bookkeeping. Spike 01 confirmed SSE chunks flow in
real time (not buffered) via res.write() + flushHeaders().

### RequestIdMiddleware runs before all guards
Date: Phase 3, T23
Reason: X-Request-Id must appear on every response — including 401s from
AuthGuard, 500s from unknown errors, and SSE streams. The middleware stamps
req.requestId and the response header at entry, before any guard can throw.
GlobalExceptionFilter reads req.requestId (not the header) so all error
responses carry the same ID. Clients may supply their own X-Request-Id
which is honoured and echoed back unchanged.

### GatewayController uses @Res() without passthrough
Date: Phase 3, T22
Reason: The streaming path calls res.write()/res.end() directly inside
StreamService.proxy(), so NestJS must not attempt to serialize the return
value. Using @Res() (passthrough: false) gives the controller full ownership
of the response lifecycle. Non-streaming path calls res.status(200).json()
manually. Both paths call res.status(200) explicitly because NestJS defaults
to 201 for POST routes when passthrough is disabled.

### AnthropicAdapter hardcodes max_tokens default of 1024
Date: Phase 2, T15
Reason: Anthropic's API requires max_tokens — it has no server-side default
and will reject calls where max_tokens is absent. We default to 1024 when
the caller does not specify. This is intentionally conservative to avoid
runaway costs. Do not remove the ?? 1024 fallback.

### AnthropicAdapter imports APIError as named export
Date: Phase 2, T15
Reason: `APIError` must be imported as a named export (`import { APIError }`)
not as `Anthropic.APIError`. When Jest mocks the module, named exports are
preserved in the mock module object but namespace-style access (`Anthropic.APIError`)
points to the mock default and instanceof checks fail. The named import
keeps mapError() instanceof checks working in both real and test contexts.

### GeminiAdapter mapError uses string.includes() not structured codes
Date: Phase 2, T16
Reason: The Google Generative AI SDK does not expose structured error codes
or typed error classes — errors surface as plain JavaScript Error objects
with status codes embedded in the message string. String matching on the
message is the only reliable detection method available. If Google adds
structured error types in a future SDK version, this can be replaced.

### GeminiAdapter translateMessages mutates the mapped message object
Date: Phase 2, T16
Reason: When prepending system content to the first user message,
translateMessages() finds the first GeminiMessage with role 'user' and
mutates its parts[0].text in place. The mapped array is local to this call,
so mutation is safe — the original request.messages are not modified.
This avoids a full re-map pass over the array.

### RouterService null/empty conditions match every request
Date: Phase 3, T19
Reason: matchesConditions() returns true when conditions is null, undefined,
or an empty object. This allows routing rules to act as unconditional
catch-alls: a rule with no conditions will match any request. A rule with
conditions that include only model_pattern will only test the model field.
This is AND logic — all specified conditions must match; absent conditions
are not tested. Do not change null/empty to "reject everything".

### RouterService undefined maxTokens silently fails token-based rules
Date: Phase 3, T19
Reason: If request.maxTokens is undefined and a routing rule has a
max_tokens_gt or max_tokens_lt condition, matchesConditions() returns false
(the rule does not match). This is intentional — a request with no token
constraint cannot satisfy a token-based routing rule. Be aware that this
means token-based rules are silently skipped for requests that omit max_tokens.

### MODEL_PREFIX_MAP is order-dependent; first match wins
Date: Phase 3, T19
Reason: RouterService.resolve() iterates MODEL_PREFIX_MAP and returns on the
first matching prefix. The 'o1' entry must appear before any other entry whose
prefix could match 'o1-mini' (there is none today, but be careful if adding
new OpenAI model families). When adding new prefixes, shorter/more-specific
prefixes must come before longer/catch-all ones within the same provider family.

### ProvidersModule instantiates adapters with new() in onModuleInit
Date: Phase 2, T13
Reason: Adapters (AnthropicAdapter, OpenAIAdapter, GeminiAdapter) create SDK
client instances per-request inside complete()/completeStream() — they have
no constructor dependencies and do not need NestJS DI. They are registered
via new() inside onModuleInit() so the registry is populated before any
request handler runs. Do not add constructor parameters to adapters; if an
adapter needs a NestJS service, refactor it as a proper NestJS provider.

### AuthGuard lastUsedAt update is fire-and-forget
Date: Phase 1, T09
Reason: Updating last_used_at on every authenticated request is bookkeeping
— the client must not pay the latency cost. The update is void-ed with a
.catch() logger fallback. A failed update only means staleness in the
lastUsedAt column; it does not affect auth correctness.

### GatewayError.retryable is defined but no retry loop exists yet
Date: Phase 2, T12
Reason: retryable is a forward-looking field populated by all adapters and
surfaced in error responses. The gateway does NOT currently retry failed
provider calls — that is planned for Phase 4. For now retryable informs the
*client* whether it is safe to retry. Do not add a retry loop without a
circuit-breaker and jitter to avoid thundering-herd against the provider.

### RateLimitGuard estimates tokens before any Redis call
Date: Phase 4, T26
Reason: Token estimation is pure CPU arithmetic (character count / 4). It must
run before checkRpm() increments the sliding window counter. If TPM would reject
the request, an RPM slot must not be consumed first — that would cause phantom
RPM decrements for requests that were always going to be blocked. CPU work is
free; Redis round-trips are not. Never move estimateTokens() inside or after the
RPM check block.

### ProviderStatusService uses Promise.allSettled not Promise.all
Date: Phase 4, T28
Reason: One down or unreachable provider must never cause the entire
GET /api/v1/providers/status endpoint to throw. Promise.all rejects as soon as
any promise rejects; Promise.allSettled always resolves with a per-promise
result. checkProvider() also has its own try/catch so it always fulfills, making
allSettled doubly defensive — it catches the rare case where checkProvider()
itself throws (e.g. decrypt failure). Do not replace with Promise.all.

### Provider status route declared before /:provider param route
Date: Phase 4, T28
Reason: Express matches routes top-to-bottom. If DELETE /:provider appeared
before GET /status, a GET /status request would match /:provider with
provider = 'status'. The @Get('status') handler must be declared before
@Delete(':provider') in the controller class. NestJS preserves declaration
order when registering Express routes.

### RateLimitResult carries limit field to avoid extra DB lookup in controller
Date: Phase 4, T27
Reason: The X-RateLimit-Limit-Rpm response header requires the configured RPM
limit value. Rather than having the controller re-query ProviderConfigsRepository
to get the limit (adding a DB round-trip on every request), runScript() in
RateLimitService accepts limit as a parameter and returns it in RateLimitResult.
The controller reads rateLimit.limit directly from the already-computed result.
Do not remove the limit field from RateLimitResult.

### StreamService stream errors keep HTTP 200 and write SSE error event
Date: Phase 3, T22
Reason: SSE uses a single long-lived HTTP connection. Once the 200 OK and
SSE headers are flushed to the client, it is impossible to change the HTTP
status code — the headers are already on the wire. A mid-stream provider
error is therefore signalled as a structured SSE data event
`{ error: true }` followed by [DONE], which clients can detect and surface
as an error to the end user. This is the standard SSE error pattern.

### Cache end-to-end verified: identical prompts return in 0ms from Redis
Date: Phase 5, T31
Reason: Live test confirmed the full cache loop: first request hits provider
(~500ms), response stored in Redis via BullMQ CacheJob. Second identical
request is intercepted before routing, served from Redis in <1ms.
The ~2s window between miss and first possible hit is acceptable — BullMQ
processes the CacheJob async after the response is already delivered to the
client. No synchronous write on the hot path.

### BullMQ CacheJob runs async — ~2s window where a repeated request is a miss
Date: Phase 5, T31
Reason: CacheJob is enqueued fire-and-forget after the provider response is
delivered. BullMQ processes it within ~1-2s depending on worker load. During
this window, a second identical request will be a cache miss. This is a
deliberate trade-off: synchronous Redis write would add latency to every
cacheable response. The window is narrow and the worst case is one extra
provider call per burst, not correctness failure.

### gw-cached- prefix on cached response IDs distinguishes hits from live responses
Date: Phase 5, T30
Reason: Cache hits fabricate an OpenAI-compatible response object with a
generated ID. The ID uses the format `gw-cached-{uuid}` so that logs,
dashboards, and downstream systems can distinguish cache-served responses
from live provider responses without inspecting headers. Live responses
carry IDs from the provider (e.g. `chatcmpl-...` for OpenAI).

### API response shapes: spec is the contract, implementation conforms to spec
Date: Phase 5, T33
Reason: Never update the spec to match a wrong implementation — fix the
implementation. The spec defines the external contract that clients depend on.
Renaming internal field names (e.g. hitRatePct → hit_rate) is a safe internal
change; changing the spec would break clients silently.

### Cost fields use raw floating point, not rounded to 4 decimal places
Date: Phase 5, T33
Reason: LLM costs are sub-cent. 4 decimal place rounding zeroes out small
values (e.g. 24 tokens × $0.002/1K = $0.000048 rounds to $0.0000). All cost
fields must preserve full precision — return the raw computed number and let
JSON serialization handle precision naturally. Minimum effective precision
is 8 decimal places for token-level cost granularity.

### top_entries in cache stats is wired but empty until CacheJob writes to cache_entries
Date: Phase 5, T33
Reason: CacheService.getStats() queries cache_entries ordered by hitCount DESC
limit 10. The query, interface, and Prisma call are all correct. top_entries
returns [] because CacheJob currently only writes to Redis — it does not upsert
into cache_entries. Populating this table is a future task. Do not remove the
query or treat empty top_entries as a bug.

### T32 (cache metadata headers) was already complete in T30
Date: Phase 5, T32
Reason: CacheInterceptor sets all required headers at the point of cache
hit/miss decision: X-Cache-Hit (true/false), X-Cache-Type (exact),
X-Gateway-Provider, X-Gateway-Model, X-Latency-Ms. These were implemented
as part of T30 when the interceptor was built. T32 required no additional code.

### Budget exceeded flag: Redis key TTL is the reset mechanism — no cron needed
Date: Phase 6, T37
Reason: When BudgetCheckerService detects exceeded status, UsageJob sets
`tenant:{id}:budget:exceeded = '1'` with TTL = secondsUntilEndOfMonth().
The key expires automatically at the start of the next billing month.
No cron job, no scheduled task — the TTL IS the reset. secondsUntilEndOfMonth()
uses new Date(year, month+1, 1) to find the next month boundary precisely.

### Budget check in RateLimitGuard is after RPM, before TPM
Date: Phase 6, T37
Reason: RPM slot is consumed as a deliberate signal that the request was
attempted. Budget check is read-only (Redis GET) and placed after RPM so
the attempt is counted, but before TPM so no token weight is added for a
request that will be rejected anyway. This ordering is intentional — do not
move the budget check before checkRpm().

### NULL monthlyBudgetUsd = no limit = always ok
Date: Phase 6, T37
Reason: If a tenant has no monthlyBudgetUsd configured, BudgetCheckerService
returns { status: 'ok', pct: null } immediately without querying usage_daily.
This is the default for all tenants until an admin sets a budget. pct: null
signals "no limit" to callers. Do not treat null as 0 or as exceeded.

### BudgetCheckerService aggregates usage_daily, not requests table
Date: Phase 6, T37
Reason: usage_daily has one row per tenant/provider/model/date with pre-summed
totalCostUsd. A SUM over usage_daily for the current month is O(providers × models × days)
— typically tens of rows. Querying the raw requests table would be O(total requests),
potentially millions of rows. Always use usage_daily for budget calculations.

### UsageJob sequence: createRequest → upsertDailyUsage → checkBudget
Date: Phase 6, T35-T37
Reason: checkBudget must run after upsertDailyUsage so the current request's
cost is already included in the usage_daily aggregate that the budget query reads.
If checkBudget ran before upsertDailyUsage, the budget check would be off by one
request and the exceeded flag might never be set for the triggering request.

### Health endpoints require no auth — called by load balancers and orchestrators
Date: Phase 6, T38
Reason: Health probes originate from infrastructure (Kubernetes, ELB, Fly.io) that
has no concept of tenant API keys. Requiring auth would make the probes fail when
the auth subsystem itself is degraded — exactly the scenario readiness probes exist
to detect. No AuthGuard on HealthController; this is intentional and correct.

### GET /health/ready returns 503, not 200 with error body
Date: Phase 6, T38
Reason: Load balancers and orchestrators make routing decisions based on HTTP status
codes, not JSON bodies. A 200 with { status: 'degraded' } would cause the LB to
keep sending traffic to a broken instance. 503 SERVICE_UNAVAILABLE is the correct
signal to stop routing. The JSON body is included in the 503 for human debugging only.

### Health checks use Promise.allSettled — DB and Redis checked in parallel
Date: Phase 6, T38
Reason: DB and Redis are independent subsystems. Checking them sequentially would
double probe latency when both are healthy, and a slow DB check would delay reporting
a Redis failure (and vice versa). Promise.allSettled ensures both checks run
concurrently and both results are always reported regardless of individual failures.

### Analytics aggregations query usage_daily, request log queries requests table
Date: Phase 7, T39-T41
Reason: usage_daily is pre-aggregated — one row per (tenant, provider, model, date).
A SUM/GROUP BY over it is O(providers × models × days), typically tens of rows.
The same aggregation over the raw requests table would be O(total requests) — millions
of rows at scale, degrading linearly with volume. The requests table is only queried
for the paginated request log (T40), which is a bounded point-lookup (LIMIT N with
the (tenantId, createdAt DESC) index) — never an unbounded aggregation.

### Parallel COUNT+SELECT share one buildRequestWhere() to prevent filter drift
Date: Phase 7, T40
Reason: getRequests() and countRequests() must apply identical WHERE conditions or
the total count and the returned page will disagree. Both call the same private
buildRequestWhere() method — any change to filters is reflected in both queries
automatically. Never inline the WHERE conditions separately in each method.

### Weighted avg_latency_ms — weight by request count, not average of averages
Date: Phase 7, T39
Reason: usage_daily stores avg_latency_ms per (provider, model, date). Averaging
those per-day averages across days ignores the fact that days with 1000 requests
should count more than days with 10. The correct formula is:
  avg = SUM(avg_latency_ms * requests) / SUM(requests)
A plain average of daily averages is statistically wrong when request volume varies
across days. Do not change to simple mean.

### pct in cost breakdown derived from fetched rows — no third DB query
Date: Phase 7, T41
Reason: total_cost_usd is computed as SUM of by_provider rows (already fetched).
pct for each entry = row.cost_usd / total * 100. This avoids a third DB round-trip
for a global SUM. If total is 0, pct = 0 for all rows (no division by zero).

### Prisma $queryRaw always returns Decimal as opaque object — convert with Number()
Date: Phase 7, T39-T41
Reason: Prisma wraps DECIMAL/NUMERIC columns in a Decimal object. JSON.stringify()
on a Decimal produces { "d": [...] } (the internal representation), not a plain number.
All $queryRaw results must call Number(row.field) before returning from the repository.
This applies to cost_usd, avg_latency_ms, and any other DECIMAL column.

### Prisma.sql fragments for optional $queryRaw filters — never string concatenation
Date: Phase 7, T39-T41
Reason: Concatenating user-supplied values into a SQL string creates SQL injection
vulnerabilities. Prisma.sql`AND provider = ${value}` is a tagged template that
parameterises the value safely. Prisma.empty is the zero-fragment identity — use it
when a filter is absent. Never build WHERE clauses with string interpolation.
