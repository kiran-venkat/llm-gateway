# LLM Gateway — Project Index

## What We Are Building
Production-grade API gateway between applications and LLM providers (OpenAI, Anthropic, Gemini).
Handles: auth, rate limiting, caching, routing, streaming, cost tracking.

## Stack
NestJS + TypeScript strict, Prisma, PostgreSQL + pgvector, Redis, BullMQ

## Architecture (one line per layer)
Request -> AuthGuard -> RateLimitGuard -> CacheInterceptor -> RouterService -> AdapterRegistry -> StreamService -> BullMQ async tail

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
Phase 1: IN PROGRESS (T07 next)
```

Update the "Current task progress" line after every session. Claude Code reads this and immediately knows where you are without you explaining it.

---

## Layer 2 — Per-Module CLAUDE.md Files

This is a technique most people miss. For complex modules, put a small `CLAUDE.md` inside the module folder itself. Claude Code picks these up automatically when working in that directory.

You don't need these yet — create them when you start each phase:
```
src/modules/providers/CLAUDE.md      ← when you start Phase 2
src/modules/auth/CLAUDE.md           ← when you start Phase 1


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