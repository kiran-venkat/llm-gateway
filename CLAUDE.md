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
