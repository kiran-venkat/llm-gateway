# LLM Gateway — Project Index

## CURRENT STATE
Last session ended: Phase 5 COMPLETE — T29–T33 done
Next task: T34 (Phase 6 start)
Tests: 383
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
Phase 6: IN PROGRESS — T34 next

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
