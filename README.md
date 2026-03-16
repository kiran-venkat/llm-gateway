# LLM Gateway

A production-grade API gateway that sits between your applications and LLM providers — OpenAI, Anthropic, and Gemini. It provides a single OpenAI-compatible endpoint with auth, tenant isolation, sliding-window rate limiting, exact-match response caching, cost tracking, and a React dashboard, all without the vendor lock-in of managed solutions like LiteLLM Cloud, Portkey, or Helicone. You own the infrastructure, the data, and the routing logic.

## Architecture

```
Client
  │
  ├─ RequestIdMiddleware  (stamps X-Request-Id on every request — including 401s)
  ├─ AuthGuard            (hash → Redis → DB; O(1) hot path via Redis cache)
  ├─ RateLimitGuard       (sliding window RPM + TPM via Lua script; budget check)
  ├─ CacheInterceptor     (SHA-256 cache key; serves Redis hit before routing)
  │
  └─ RouterService        (5-step waterfall: header → tag → model prefix → rules → fallback)
       │
       └─ AdapterRegistry → Provider API  (OpenAI / Anthropic / Gemini)
            │
            └─ StreamService  (SSE proxy — writes chunks as they arrive, never buffers)
                 │
                 └─ res.end() ──► Client receives complete response
                      │
                      └─ BullMQ (fire-and-forget)
                           └─ UsageJob: cost calc → requests table → usage_daily → budget check
```

Non-streaming path returns JSON. Streaming path writes `data: <chunk>\n\n` SSE frames. Both paths share the same auth, rate-limit, cache, and async tail.

## Quick Start

### Prerequisites

- Node.js 18+
- Docker + Docker Compose

### Setup

```bash
git clone <repo>
cd llm-gateway
cp .env.example .env
# Edit .env: set ENCRYPTION_KEY (see below) and add at least one provider key later via API
```

Generate an encryption key (required — provider API keys are AES-256-GCM encrypted at rest):

```bash
openssl rand -hex 32
# paste the output as ENCRYPTION_KEY in .env
```

```bash
# Start PostgreSQL (port 5433) and Redis
docker-compose up postgres redis -d

npm install
npx prisma migrate dev --name init
npx ts-node scripts/seed-dev.ts   # seeds model pricing + a dev tenant

npm run start:dev
# API running at http://localhost:3000
# Swagger UI at  http://localhost:3000/api/docs
```

### Dashboard

```bash
cd dashboard
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:3000
npm run dev
# Open http://localhost:5173
```

## API Reference

Interactive Swagger UI: **http://localhost:3000/api/docs**

All endpoints except `/health` require `Authorization: Bearer <gateway-key>`.

### Core endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion (streaming + non-streaming) |
| `POST` | `/api/v1/providers` | Add/update a provider config with encrypted API key |
| `GET` | `/api/v1/providers/status` | Live latency probe per provider |
| `POST` | `/api/v1/keys` | Create a tenant API key (raw value shown once) |
| `GET` | `/api/v1/analytics/usage` | Token usage time series |
| `GET` | `/api/v1/analytics/cost` | Cost breakdown by provider |
| `GET` | `/api/v1/analytics/requests` | Paginated request log with filters |
| `GET` | `/api/v1/analytics/cache` | Cache hit rate and cost savings |

### Postman

Import `postman-collection.json` into Postman, then set the `api_key` collection variable to your gateway key. The `base_url` variable defaults to `http://localhost:3000`.

## Key Design Decisions

### 1. Plugin/adapter pattern over a factory switch

Each provider is an independent class implementing `IProviderAdapter` — four methods: `complete()`, `completeStream()`, `estimateTokens()`, and `mapError()`. Adding Cohere or Mistral means writing one file and one line in `onModuleInit()`. A switch statement or factory would require touching the routing layer, the streaming layer, and the error layer every time. The adapter registry gives you a closed core that's open for extension: rate limiting, caching, cost tracking, and streaming all work automatically for any new adapter.

### 2. Sliding window over fixed window for rate limiting

A fixed window (e.g. 60 requests per minute, counter resets at :00) allows bursting: 60 requests at :59 and 60 more at :00 — 120 in two seconds against a nominally 60 RPM limit. The sliding window Lua script atomically removes expired timestamps and counts the remaining window, so the limit is enforced across any 60-second span regardless of wall-clock alignment. The script runs inside a single Redis EVAL call, making the check-and-increment atomic — no race conditions possible between concurrent requests.

### 3. Exact-match cache as V1, semantic cache as V2

The current cache layer hashes `tenant + provider + model + messages + maxTokens + temperature` with SHA-256 for an O(1) exact lookup in Redis. This is simple, deterministic, and has zero false positives. The alternative — vector similarity via pgvector — would return cached results for semantically equivalent but lexically different prompts, dramatically improving hit rates for conversational workloads. pgvector is already installed in the schema (the `pgvector` extension is provisioned). The switch from exact to semantic is an interceptor-level change — the gateway's routing, streaming, and async tail are unaffected.

### 4. Async tail via BullMQ — never block the hot path

Every DB write (request record, daily aggregate, budget flag) happens after `res.end()` in a BullMQ job. The client's latency is purely provider latency — our bookkeeping adds zero milliseconds. The tradeoff is a ~2 second window where a repeat request is a cache miss (the `CacheJob` hasn't finished writing yet), and a tiny risk of lost usage data if the worker crashes before processing. Both are acceptable for a gateway: the miss means one extra provider call, not incorrect data; the job has `attempts: 3` with exponential backoff. Synchronous writes on the hot path would be the wrong trade — a slow Postgres write would appear as gateway latency to the caller.

### 5. Shared database multi-tenancy over schema-per-tenant

Every table has a `tenantId` UUID column. `BaseRepository` enforces it on every query — calling without `tenantId` throws `MissingTenantIdError` at construction time, not at query time. Schema-per-tenant (a separate Postgres schema or database per tenant) gives stronger isolation but makes migrations a nightmare at scale — you'd need to migrate N schemas for every change. Shared-schema with enforced column scoping is the correct choice for an early-stage gateway: it migrates once, scales horizontally, and the `BaseRepository` pattern makes cross-tenant data leaks structurally impossible rather than just convention-dependent.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | NestJS + TypeScript strict | Modular DI, decorators match the middleware/guard/interceptor architecture, strict TS catches class of bugs at compile time |
| Database | PostgreSQL + pgvector | Relational integrity for cost accounting; pgvector available for semantic cache V2 without changing infra |
| Cache/sessions | Redis | Sub-millisecond auth cache, atomic Lua rate limiting, BullMQ backing store |
| Queue | BullMQ (Bull v4) | Reliable at-least-once delivery, retries with backoff, zero hot-path latency |
| Providers | OpenAI, Anthropic, Gemini | Covers GPT-4o, Claude, Gemini — adapter pattern makes adding more a one-file change |
| Dashboard | React + Vite + Recharts + shadcn/ui | Fast dev loop, composable chart primitives, accessible component library |

## Development

### Running tests

```bash
npm test            # 474 unit tests (3 skipped — require live provider keys)
npm run test:e2e    # integration tests (requires running DB + Redis)
npm run test:cov    # coverage report
```

### Adding a new provider

```typescript
// 1. Implement the interface (src/modules/providers/adapters/cohere/)
export class CohereAdapter implements IProviderAdapter {
  readonly name = 'cohere';

  async complete(req: GatewayRequest, apiKey: string): Promise<GatewayResponse> { ... }
  async *completeStream(req: GatewayRequest, apiKey: string): AsyncGenerator<StreamChunk> { ... }
  estimateTokens(messages: Message[]): number { return /* char count / 4 */ }
  mapError(err: unknown): GatewayError { ... }
}

// 2. Register it — one line in ProvidersModule.onModuleInit()
registry.register(new CohereAdapter());

// Done. Routing, caching, rate limiting, cost tracking, and streaming all work automatically.
```

Add a pricing row to `model_pricing` in `scripts/seed-dev.ts` and the adapter is fully integrated.

### Project structure

```
src/
  common/          # Guards, interceptors, filters, decorators, base repo, logger
  config/          # Joi-validated environment config
  modules/
    gateway/       # POST /v1/chat/completions — routing, streaming, response shaping
    providers/     # Adapter registry, per-provider adapters, provider config CRUD
    router/        # 5-step routing waterfall + model prefix map
    cache/         # CacheInterceptor, CacheService, cache key hash
    usage/         # UsageJob (BullMQ), CacheJob, CostCalculator, BudgetChecker
    rate-limit/    # Sliding window Lua, RateLimitService, RateLimitGuard
    analytics/     # Usage/cost/cache/request log endpoints
    api-keys/      # Key generation, revocation, SHA-256 storage
    tenants/       # Tenant CRUD
  health/          # /health and /health/ready probes
  prisma/          # PrismaService singleton
dashboard/         # React + Vite frontend
```

## Roadmap

- [ ] Semantic cache — pgvector cosine similarity for near-duplicate prompt hits
- [ ] Circuit breaker — automatic provider fallback on sustained errors
- [ ] AI routing agent — autonomous model selection based on cost/latency/quality signals
- [ ] Budget forecasting — project month-end spend from current trajectory
- [ ] MCP server — expose the gateway as a Model Context Protocol tool
- [ ] Streaming cost — real token counts from provider stream metadata
