# LLM Gateway — Project Index

## CURRENT STATE
Last session ended: Phase 3 complete, T23 done
Next task: T24 — Redis Lua sliding window rate limiter
Tests passing: 284
Build status: clean
Active branch: dev

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
Phase 4: IN PROGRESS — T24 next

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
string. The adapter strips system messages from the array and promotes
the last one found to the `system` param before calling the SDK.

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
