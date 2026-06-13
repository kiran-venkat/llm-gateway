# V1 Scope and Limitations

This document catalogs every deliberate V1 boundary, known gap, and "works but doesn't
scale to X" trade-off found across the codebase. It is a reference for future contributors
and a planning input for V2. Items fall into two categories: **deliberate scope** (a
conscious decision made during V1, not a mistake) and **not-yet-built** (a gap that was
deferred for time or complexity reasons). Both are documented with equal candour.

---

## 1. Onboarding & Tenancy

### 1.1 Operator-driven onboarding — no self-service
| | |
|---|---|
| **What** | Every onboarding action — creating a tenant, issuing an API key, configuring a provider — requires the `ADMIN_SECRET`. There is no signup page, OAuth flow, or self-registration endpoint. |
| **Why** | Deliberate V1 scope. The gateway is designed as internal infrastructure. Building a self-service layer (registration, email verification, billing integration) was out of scope. |
| **V2 path** | Add a registration flow: `POST /auth/register` creates a tenant + hashes password, returns a session token. Add a self-service key management UI. Requires an accounts layer separate from the current `tenants` table. |
| **Severity** | Cosmetic for internal use. Functional blocker for a public SaaS product. |

### 1.2 No "user" concept — tenant is the auth unit
| | |
|---|---|
| **What** | There is no `users` table. Authentication is entirely key-based — one tenant identity per API key. The only user-like concept is `userLabel` in `RequestSpan`, which is an opaque trace token for analytics only, not for auth or access control. |
| **Why** | Deliberate. The gateway authenticates the calling application, not a human. Multi-user access to a single tenant account (role-based permissions, user-level API keys) was not a V1 requirement. |
| **V2 path** | Add a `users` table with `tenantId` FK, roles (`admin`, `viewer`), and password/OAuth credentials. Existing API keys can belong to a user. Dashboard login would replace the implicit "single admin per tenant" model. |
| **Severity** | Functional gap for any multi-user team operating the gateway together. |

### 1.3 Flat tenant hierarchy — no orgs or sub-tenants
| | |
|---|---|
| **What** | The data model is `tenant → api_keys / provider_configs / routing_rules`. There is no `organization → team → tenant` hierarchy. A single tenant cannot model "Acme Corp has a Data Science team and a Product team" with independent rate limits and budgets. |
| **Why** | Deliberate simplification. Every layer of hierarchy multiplies complexity in rate limiting, billing, and analytics queries. |
| **V2 path** | Add an optional `parentTenantId` FK on `tenants` to create an org/team tree, or introduce a separate `organizations` table. Budget and rate-limit queries need to aggregate up the tree. |
| **Severity** | Functional. A big company onboarding today needs one tenant per team, not one per company. |

### 1.4 Provider key management is admin-only — no BYOK self-service
| | |
|---|---|
| **What** | `POST /api/v1/providers` is protected by `AdminGuard`. Tenants cannot configure their own provider API keys. A tenant who wants to bring their own OpenAI key must send it out-of-band (email, Slack) and the operator enters it on their behalf. |
| **Why** | Deliberate. An operator running the gateway on shared infrastructure may want to own the provider relationships and not allow tenants to inject arbitrary API keys. |
| **V2 path** | Add a `PATCH /api/v1/providers/:provider/key` endpoint behind `AuthGuard` that only allows a tenant to update their own provider key. The admin still creates the initial record. |
| **Severity** | Functional friction for tenants who want self-service key rotation. |

### 1.5 Rate limits are per-tenant, not per-API-key
| | |
|---|---|
| **What** | `RateLimitGuard` looks up rate limits from `provider_configs` scoped by `tenantId`. All API keys belonging to the same tenant share the same RPM/TPM bucket. There is no per-key throttling. |
| **Why** | Deliberate. Per-key rate limiting requires a separate Redis namespace and complicates the limit-header logic. V1 treats the tenant as the billing unit. |
| **V2 path** | Add `rateLimitRpm` / `rateLimitTpm` columns to `api_keys`. If set, they shadow the tenant-level limits. `RateLimitGuard` checks key-level first, falls back to tenant-level. |
| **Severity** | Functional for multi-team tenants where one heavy user should not exhaust the shared limit. |

### 1.6 `monthly_spend_limit_usd` on `provider_configs` is stored but never enforced
| | |
|---|---|
| **What** | `POST /api/v1/providers` accepts `monthly_spend_limit_usd`, stores it, and returns it in the response. However, `BudgetCheckerService` only reads `tenant.monthlyBudgetUsd` — it never reads `providerConfig.monthlySpendLimitUsd`. Setting a per-provider spend limit silently does nothing. |
| **Why** | Not-yet-built. The column was added to the schema in anticipation of per-provider budget enforcement, but the enforcement logic was never written. |
| **V2 path** | Extend `BudgetCheckerService.checkBudget()` to accept a `provider` parameter and also query `usage_daily` aggregated by that provider against the per-provider limit. Set a separate Redis flag `tenant:{id}:budget:{provider}:exceeded`. |
| **Severity** | **Functional.** An operator who sets `monthly_spend_limit_usd` on a provider config believes it is enforced. It is not. |

---

## 2. Provider Layer

### 2.1 Three providers only — OpenAI, Anthropic, Gemini
| | |
|---|---|
| **What** | `AdapterRegistry` has three registered adapters. There is no support for Azure OpenAI, AWS Bedrock, Cohere, Mistral, Ollama (self-hosted), or any other provider. |
| **Why** | Deliberate V1 scope. The adapter pattern (`IProviderAdapter` interface + `registry.register()`) was designed specifically to make adding providers cheap — zero changes to core gateway code. |
| **V2 path** | Implement `IProviderAdapter` for each new provider. See [`.claude/commands/new-provider.md`](../.claude/commands/new-provider.md) for the exact steps. |
| **Severity** | Cosmetic if three providers are sufficient; functional otherwise. |

### 2.2 No automatic provider fallback chains
| | |
|---|---|
| **What** | If a provider call fails, the error surfaces to the client as a 503. There is no "try OpenAI, fall back to Anthropic" logic. The retry in `GatewayService.callWithRetry()` retries the same provider once after 500ms — it does not route to a different provider. |
| **Why** | Deliberate. Fallback requires knowing which providers have equivalent models, a circuit-breaker to avoid retrying a known-down provider, and jitter to avoid thundering-herd. All of this was deferred to Sprint S2 (T65). |
| **V2 path** | T65: Add per-provider circuit-breaker state in Redis (`tenant:{id}:circuit:{provider}` = `OPEN|HALF_OPEN`). `RouterService` falls through to the next provider in a configured fallback chain when the primary circuit is open. |
| **Severity** | Functional. A provider outage means 100% error rate for affected requests until the operator manually re-routes. |

### 2.3 One API key per provider per tenant — no multi-key load balancing
| | |
|---|---|
| **What** | `provider_configs` has a `UNIQUE(tenantId, provider)` constraint. A tenant can have at most one API key per provider. There is no round-robin or weighted routing across multiple keys for the same provider. |
| **Why** | Deliberate simplification. The unique constraint ensures a deterministic key lookup without a selection strategy. |
| **V2 path** | Relax the unique constraint. Add a `weight` column to `provider_configs`. `ProviderConfigsRepository.getDecryptedApiKey()` changes from `findFirst` to a weighted random selection across active configs. |
| **Severity** | Functional for high-throughput tenants hitting provider rate limits on a single key. |

### 2.4 Single retry with fixed 500ms delay — no circuit breaker, no jitter
| | |
|---|---|
| **What** | `GatewayService.callWithRetry()` retries `retryable` errors exactly once after a fixed 500ms pause. The V2-PLAN.md explicitly notes: "before Sprint 4 adds agent-driven provider switching, a per-provider circuit-breaker should be added." |
| **Why** | T59 intentionally chose one retry over no retry, acknowledging the missing circuit-breaker. One retry with fixed delay is safe for a single attempt; it degrades into thundering-herd if scaled out. |
| **V2 path** | T65: circuit-breaker state in Redis. Streaming path (`completeStream`) currently has no retry at all — the error becomes an SSE `{ error: true }` event. Consider whether streaming should also retry. |
| **Severity** | Cosmetic at low RPS. Functional under provider degradation at scale. |

### 2.5 Anthropic health probe is not free
| | |
|---|---|
| **What** | `ProviderStatusService.probeAnthropic()` sends an actual `messages.create()` call with `max_tokens: 1` every time the cache expires (every 30 seconds per tenant). OpenAI's probe calls `models.list()` (no tokens consumed). Gemini's probe calls `generateContent('ok')` (minimal tokens). |
| **Why** | Anthropic's API has no equivalent of a lightweight ping or models-list endpoint. A real completion is the only reliable connectivity test. |
| **V2 path** | Accept the cost, or move to a models-list-style probe once Anthropic exposes one. Consider increasing the cache TTL from 30s to 120s to reduce probe frequency. |
| **Severity** | Cosmetic cost leak (~$0.000002 per probe) but multiplies with tenant count and scale. |

---

## 3. Caching

### 3.1 Exact-match cache only — no semantic cache
| | |
|---|---|
| **What** | The cache key is `SHA-256(tenantId + provider + model + messages + maxTokens + temperature)`. Two semantically identical prompts worded differently ("What is 2+2?" vs "How much is two plus two?") are always cache misses. |
| **Why** | Deliberate V1 scope. Semantic cache requires pgvector, embedding generation per request, a cosine similarity query, and a similarity threshold that must be calibrated per use case. Planned as Sprint S5. |
| **V2 path** | Sprint S5: Before the Redis exact-match check, query pgvector with the prompt embedding at cosine threshold 0.95. Store embeddings in a new `cache_embeddings` table. |
| **Severity** | Functional cost issue for AI agent workloads where the same intent is expressed differently across turns. |

### 3.2 Cache TTL is hardcoded at 3600 seconds — `x-cache-ttl` header is documented but not implemented
| | |
|---|---|
| **What** | The API contracts spec lists `x-cache-ttl?` as a request parameter. `ChatCompletionRequestDto` does not include it, `GatewayController` does not read it as a header, and `GatewayService` hardcodes `ttlSeconds: 3600` in both the streaming and non-streaming cache-enqueue calls. |
| **Why** | Not-yet-built. The spec was written ahead of implementation and this field was missed. |
| **V2 path** | Add `@Headers('x-cache-ttl') xCacheTtl?: string` to the controller, parse it as an integer, pass it through `GatewayService` to the `CacheJobData`, and remove the hardcoded 3600. |
| **Severity** | **Functional.** A caller who sets `x-cache-ttl` believing it overrides the TTL is silently ignored. |

### 3.3 No cache invalidation API
| | |
|---|---|
| **What** | There is no endpoint to manually invalidate a cached response. If a prompt returns a bad or stale answer, it stays cached for up to 3600 seconds (or until Redis is flushed). `x-no-cache` bypasses the cache on the next request but does not delete the stale entry. |
| **Why** | Deliberate V1 omission. Cache invalidation was considered a V2 operational concern. |
| **V2 path** | `DELETE /api/v1/cache?model=&hash=` (tenant-scoped) that calls `redis.del(key)` and removes the `cache_entries` row. A "flush all" for a tenant would be `SCAN + DEL` on `tenant:{id}:cache:*`. |
| **Severity** | Operational friction. A tenant who gets a bad cached response has no self-service remedy. |

### 3.4 ~2-second window where repeated identical requests are cache misses
| | |
|---|---|
| **What** | `CacheJob` is enqueued fire-and-forget after `res.end()`. BullMQ processes it within ~1–2 seconds. During that window, a second identical request is a miss and hits the provider again. |
| **Why** | Deliberate trade-off documented in ADR-004. A synchronous Redis write on the hot path would add ~1–5ms latency to every cacheable response. The 2-second window means at most one extra provider call per burst, not a correctness failure. |
| **V2 path** | Accept for most workloads. For very high-frequency identical prompts (agent tool loops), a synchronous write path behind a feature flag could eliminate the window. |
| **Severity** | Cosmetic cost leak in burst scenarios. Not a correctness issue. |

### 3.5 Streaming responses are never cached
| | |
|---|---|
| **What** | `CacheInterceptor` skips requests where `body.stream === true`. A streaming request for a prompt that has a cached non-streaming response still hits the provider. |
| **Why** | Deliberate. Replaying a cached response as SSE would require fabricating a chunked stream, which adds implementation complexity for an edge case. |
| **V2 path** | In the cache interceptor, if a cache hit is found and `stream: true`, replay the cached content as synthetic SSE chunks. |
| **Severity** | Cosmetic. Streaming callers never benefit from the cache. |

---

## 4. Rate Limiting & Budgets

### 4.1 Budget check happens before streaming begins — no mid-stream cutoff
| | |
|---|---|
| **What** | `RateLimitGuard` runs before any handler code. A `budget_exceeded` 402 is returned before the SSE connection opens. If a request slips through and the budget is only exceeded during streaming (e.g. the budget is crossed by the `UsageJob` of a concurrent request), the stream completes normally — the next request will be blocked. |
| **Why** | Deliberate. Once SSE headers are flushed, the HTTP status code cannot be changed (headers are on the wire). Budget enforcement at the guard level is the only safe interception point. |
| **V2 path** | Accept this. The ~2s async lag in `UsageJob` writing the budget flag means at most one request slips through above the limit. This is standard for any async billing system. |
| **Severity** | Cosmetic over-spend of one request when budget boundary is crossed. |

### 4.2 No emergency rate-limit override
| | |
|---|---|
| **What** | To temporarily raise a tenant's rate limit for an emergency or burst event, an admin must issue a `PATCH /api/v1/providers` call to update `rate_limit_rpm` in the DB. There is no ephemeral override (e.g. "bypass rate limit for the next 10 minutes"). |
| **Why** | Not-yet-built. Ephemeral overrides require a Redis TTL-based flag separate from the DB config. |
| **V2 path** | `POST /api/v1/tenants/:id/rate-limit-override` with `{ provider, multiplier, durationSeconds }` that sets a Redis key the guard checks before the normal limit. |
| **Severity** | Operational friction. |

### 4.3 Budget warning (80%) is a log line only — no push notification
| | |
|---|---|
| **What** | When `BudgetCheckerService` detects `pct >= 80`, it calls `this.logger.warn()`. No webhook fires, no email is sent, no Slack message is posted. The operator has no proactive signal that a tenant is approaching their limit. |
| **Why** | Not-yet-built. Alerting infrastructure (Sprint S3, T67) was deferred to V2. |
| **V2 path** | Sprint S3: `POST /api/v1/tenants/:id/webhooks` for budget alerts. `BudgetCheckerService` calls the webhook on `warning` and `exceeded` state transitions, with idempotency to avoid repeated alerts. |
| **Severity** | Operational. Budget limits are silently hit with no advance warning to the tenant or operator. |

### 4.4 Budget reset is UTC month boundary — no configurable billing cycle
| | |
|---|---|
| **What** | `secondsUntilEndOfMonth()` resets the budget at `new Date(year, month+1, 1)` — i.e. midnight UTC on the first of next month. All tenants share the same billing cycle. There is no "bill from the 15th" or "30-day rolling window" option. |
| **Why** | Deliberate V1 simplification. |
| **V2 path** | Add `billingCycleStartDay` to the `tenants` table. `secondsUntilEndOfMonth()` becomes `secondsUntilNextBillingCycle(tenant)`. |
| **Severity** | Functional for tenants whose provider bills do not align to calendar months. |

---

## 5. Data & Compliance

### 5.1 Message content is never stored — only metadata
| | |
|---|---|
| **What** | `UsageRepository.createRequest()` stores provider, model, token counts, cost, latency, status, and error codes. The actual `messages[]` array content is not persisted anywhere in the DB. The requests table has no `body` or `content` column. |
| **Why** | Deliberate PII/compliance decision. Storing message content would require data classification, encryption at rest for content, right-to-erasure APIs, and cross-region data residency decisions. Not-storing is the safe default. |
| **V2 path** | If observability requires it, add an opt-in `store_content: true` flag per tenant that writes encrypted message bodies to a separate table with explicit retention policy. |
| **Severity** | This is the correct V1 behaviour. Changing it would require a full compliance review. |

### 5.2 `userLabel` in `RequestSpan` relies on caller pseudonymization
| | |
|---|---|
| **What** | The `x-user-id` header value is stored verbatim in `request_spans.userLabel`. The schema comment, Swagger docs, and `CLAUDE.md` all state it must be an opaque token. The gateway does no hashing or validation of this field. If a caller sends an email address as `x-user-id`, it is stored as PII. |
| **Why** | Deliberate: the gateway cannot know the caller's pseudonymization scheme. Hashing at the gateway level would break callers who already hash before sending. Enforcement is the caller's responsibility. |
| **V2 path** | Add a server-side option: `tenant.userLabelHashing = true` causes the gateway to SHA-256 hash the incoming `x-user-id` before storing it. This gives an operator control without breaking existing compliant callers. |
| **Severity** | **Compliance risk** if callers pass real user identifiers. The documentation is clear but there is no technical enforcement. |

### 5.3 No data retention policy — records accumulate indefinitely
| | |
|---|---|
| **What** | The `requests` and `request_spans` tables have no `deleted_at` column, no TTL, and no automated purge job. At scale, `requests` grows at O(total_requests) forever. There is no API to delete historical request data. |
| **Why** | Not-yet-built. Retention logic (configurable per tenant, automated cron, partial vs full purge) was deferred. |
| **V2 path** | Add `retentionDays` to `tenants` table. Add a scheduled BullMQ job (nightly) that `DELETE FROM requests WHERE tenantId = ? AND createdAt < NOW() - INTERVAL '? days'`. Add `DELETE /api/v1/tenants/:id/data` for GDPR right-to-erasure. |
| **Severity** | **Compliance gap** for GDPR/CCPA deployments. Storage cost concern at scale. |

### 5.4 No right-to-delete API
| | |
|---|---|
| **What** | There is no endpoint to delete a tenant's historical data. `PATCH /api/v1/tenants/:id` can deactivate a tenant. Cascade deletes (`ON DELETE CASCADE`) on the Prisma schema would remove child records if a tenant row were deleted — but there is no `DELETE /api/v1/tenants/:id` endpoint. |
| **Why** | Not-yet-built. Tenant deletion requires verifying no outstanding billing, archiving for audit, and cascading through usage_daily. |
| **V2 path** | `DELETE /api/v1/tenants/:id` behind `AdminGuard` with a soft-delete (set `isActive = false, deletedAt = NOW()`) followed by an async purge job for all child records. |
| **Severity** | **Compliance blocker** for GDPR deployments where a data subject can demand erasure. |

### 5.5 Single region — no data residency controls
| | |
|---|---|
| **What** | The entire stack (EC2, RDS, ElastiCache, S3) is in `ap-south-1` (Mumbai). All request metadata, usage_daily aggregates, and cache entries are written to this region regardless of where the API caller is located. |
| **Why** | Deliberate V1 scope. Multi-region requires read replicas, cross-region replication, and per-tenant region routing — significant infrastructure complexity. |
| **V2 path** | Parameterize the Terraform/EB config per region. Add a `dataRegion` field to tenants. Route `usage_daily` writes to the tenant's designated region DB. This is a major infrastructure project. |
| **Severity** | **Compliance blocker** for EU/EEA deployments requiring GDPR data residency in the EU. |

---

## 6. Observability

### 6.1 No alerting integration — all signals are log lines only
| | |
|---|---|
| **What** | Budget warnings (80%), budget exceeded (100%), provider probe failures, BullMQ job failures, and unhandled errors all produce structured log lines to stdout. There is no Slack, email, PagerDuty, or webhook integration. Logs are only useful if someone is watching or a log shipper is configured. |
| **Why** | Not-yet-built. Sprint S3 (T67) is specifically "Budget intelligence — webhooks, alerts." |
| **V2 path** | Sprint S3: `POST /api/v1/tenants/:id/webhooks` to register alert destinations. `AlertJob` BullMQ processor fires on budget warning, budget exceeded, and provider down events. |
| **Severity** | Operational. The gateway is effectively silent to operators at rest. |

### 6.2 Redis is a single point of failure for all requests
| | |
|---|---|
| **What** | `AuthGuard` calls `redis.get()` with no try/catch around the Redis call — if Redis is unavailable, all authenticated requests fail with a 500. `RateLimitGuard` runs a Lua script via Redis — same failure mode. `BudgetCheckerService` reads the budget flag from Redis. There is no degraded-mode fallback (e.g. "if Redis is down, skip rate limiting and auth-cache and hit DB only"). |
| **Why** | Deliberate for simplicity. Adding fallback paths (DB-only mode) for every Redis call would double the code surface. Redis is treated as critical infrastructure, not optional. |
| **V2 path** | Wrap Redis calls in `AuthGuard` with a try/catch that falls through to DB on connection error. Rate limiting and budget checks could be skipped (with a log warning) when Redis is unavailable, trading correctness for availability. |
| **Severity** | Functional. Redis downtime = complete gateway downtime, including health check pass (the `/health/ready` check correctly returns 503 on Redis failure, so load balancers will stop routing — but there is no graceful degradation). |

### 6.3 `CostCalculatorService` pricing is loaded once at startup — no live refresh
| | |
|---|---|
| **What** | `onModuleInit()` loads pricing from `model_pricing` into an in-memory `Map`. `refreshPricing()` exists but nothing calls it after startup. Adding a new model or updating a price requires a service restart to take effect. |
| **Why** | Deliberate for performance. DB reads on every cost calculation would add latency to every request. |
| **V2 path** | Schedule a periodic `refreshPricing()` call (e.g. every 5 minutes via `@Cron`) or expose a `POST /api/v1/pricing/refresh` admin endpoint. |
| **Severity** | Operational. New model pricing silently computes 0 cost until the service restarts. |

---

## 7. Security

### 7.1 Key revocation has a 5-minute propagation window
| | |
|---|---|
| **What** | `AuthGuard` caches authenticated tenant contexts in Redis at `auth:hash:{hash}` with a 300-second TTL (`AUTH_CACHE_TTL_SECONDS`). `ApiKeysService.revoke()` eagerly deletes this cache entry — so new requests using the revoked key are rejected immediately. However, any request that passed `AuthGuard` before the revocation call will complete normally (the guard already ran). The API documentation correctly states "In-flight requests using this key will receive 401 after Redis TTL expires" — but eager deletion means the window is only until the next `AuthGuard` check, not a full 5 minutes. |
| **Why** | Deliberate. The eager cache deletion on revocation (`redis.del(cacheKey)`) was implemented specifically to minimise this window. The residual window is only for already-in-flight requests that have passed the guard. |
| **V2 path** | For zero-tolerance revocation, add a Redis SET `revoked:{hash}` checked at the top of `AuthGuard` before the cache lookup. This adds one Redis call to every request. |
| **Severity** | Acceptable for most use cases. Functional concern for security-sensitive revocation (e.g. suspected key compromise). |

### 7.2 No admin action audit log
| | |
|---|---|
| **What** | All admin operations — creating tenants, issuing API keys, configuring providers, modifying routing rules — are protected by `AdminGuard` but produce no audit trail. There is no `admin_audit_log` table, no record of who did what or when. The only evidence is in application logs (stdout), which are ephemeral if no log shipper is configured. |
| **Why** | Not-yet-built. Sprint S4 (T74–T81 "AI control plane") includes audit logging as a prerequisite for the AI routing agent. |
| **V2 path** | Add an `admin_events` table: `id, actor (admin key prefix or identifier), action, resourceType, resourceId, payload JSONB, createdAt`. All `AdminGuard`-protected endpoints write a row. Expose `GET /api/v1/admin/audit` for review. |
| **Severity** | **Compliance gap** for SOC 2 / ISO 27001 requirements. Security gap for post-incident investigation. |

### 7.3 Single static `ADMIN_SECRET` — no admin key rotation without restart
| | |
|---|---|
| **What** | There is one `ADMIN_SECRET` environment variable. All admin operations share it. There is no admin key rotation, no per-admin identity, and no way to invalidate the admin secret without redeploying the service. |
| **Why** | Deliberate V1 simplification. Admin access is expected to be restricted to the operator deploying the gateway. |
| **V2 path** | Replace `ADMIN_SECRET` with an `admin_keys` table (same hash/prefix pattern as tenant API keys). Admins get revocable keys. `AdminGuard` looks up by hash. Rotation is a `POST /api/v1/admin/keys` without restart. |
| **Severity** | Security concern if the admin secret is compromised — full recovery requires a redeploy. |

---

## 8. Scalability

### 8.1 Single EC2 instance — no horizontal scaling in production
| | |
|---|---|
| **What** | The production deployment is one `t3.micro` EC2 instance with no load balancer and no auto-scaling group. All stateless (NestJS HTTP handlers, BullMQ workers) and stateful (Redis, Postgres) components run through this single instance. |
| **Why** | Deliberate V1 cost decision. A single instance is sufficient for development, demo, and low-traffic production. The application code is fully stateless — all shared state is in Redis and Postgres. |
| **V2 path** | The architecture already supports horizontal scale-out: add an ALB in front of multiple EC2 instances (or ECS tasks). BullMQ workers can run as separate processes. Redis and Postgres are already external. No application code changes needed. |
| **Severity** | Functional ceiling at roughly 50–100 concurrent requests on a `t3.micro` before the single instance becomes the bottleneck. |

### 8.2 Prisma connection pool uses framework defaults — no explicit sizing
| | |
|---|---|
| **What** | `PrismaService` extends `PrismaClient` with no constructor arguments. Prisma defaults to a connection pool of `min(nCPUs * 2 + 1, 10)` — on the production `t3.micro` (2 vCPUs), that is 5 connections. Under high concurrency, every request that involves a DB query (auth cache miss, rate limit config load, usage write) competes for the same 5-connection pool. |
| **Why** | Not configured. The default is fine for low traffic but needs explicit tuning for production scale. |
| **V2 path** | Pass `datasources: { db: { url: process.env.DATABASE_URL + '?connection_limit=20&pool_timeout=10' } }` to `PrismaClient`. PgBouncer in front of RDS is the correct solution for multi-instance deployments. |
| **Severity** | Functional under load. Connection pool exhaustion causes request queuing, latency spikes, and eventual timeouts. |

### 8.3 BullMQ and application share the same Redis instance
| | |
|---|---|
| **What** | `AppModule` registers a single `RedisModule` with one `REDIS_URL`. All consumers — `AuthGuard` auth cache, `RateLimitService` sliding-window Lua, `CacheInterceptor` response cache, `ProviderStatusService` probe cache, and all three BullMQ queues (`usage`, `cache`, `daily-close`) — share this one connection. Under high load, BullMQ queue operations and hot-path Redis calls compete for the same I/O channel. |
| **Why** | Deliberate V1 simplification. A single Redis instance is cheaper and operationally simpler. |
| **V2 path** | Separate BullMQ onto its own Redis instance via `BullModule.forRootAsync` pointing to a second `REDIS_QUEUE_URL`. Rate-limit and auth cache stay on the primary Redis for lowest latency. |
| **Severity** | Functional under high load. BullMQ queue saturation can increase hot-path Redis latency. |

---

## 9. Streaming

### 9.1 Client disconnect during streaming does not abort the provider call
| | |
|---|---|
| **What** | `StreamService.proxy()` iterates `AsyncIterable<StreamChunk>` with no `req.on('close')` listener. If a client disconnects mid-stream, `response.write()` calls fail silently (Node.js swallows writes to a destroyed socket), but the `for await` loop continues consuming chunks from the provider SDK until completion. The provider bills for all generated tokens even though no client received them. |
| **Why** | Not implemented. Aborting a provider stream requires either an `AbortController` signal passed into the adapter's `completeStream()`, or a destructured generator. Neither was part of V1. |
| **V2 path** | Add `req.on('close', () => abort())` in `proxy()`. Pass an `AbortSignal` to each adapter's `completeStream()`. OpenAI and Anthropic SDKs accept `signal` on their stream calls. Gemini requires manually closing the stream iterator. |
| **Severity** | Functional cost leak. Under high client churn (mobile clients, flaky connections), token waste accumulates. |

### 9.2 Streaming token counts are estimated, not exact — TPM accuracy is approximate
| | |
|---|---|
| **What** | `RateLimitGuard` calls `adapter.estimateTokens(messages)` before the request, which uses `Math.ceil(totalCharacters / 4)`. This estimate gates the TPM check. Actual token counts arrive only after the stream completes (from the provider) and are recorded in `UsageJob`. There is no correction: if the estimate was 500 tokens but actual usage was 2000, the TPM window was only decremented by 500. |
| **Why** | Deliberate. The token count from a streaming response is unavailable until the last chunk arrives. A pre-flight estimate is the only option for a synchronous guard. |
| **V2 path** | After `UsageJob` records actual token counts, compare against the estimate and post-correct the TPM window with a negative increment (`ZADD` with a correction job). This adds complexity but makes TPM enforcement accurate. |
| **Severity** | Functional for strict token budget enforcement. Tenants can exceed TPM limits by a factor proportional to estimate error (typically 1.5–2x). |

---

## 10. Miscellaneous

### 10.1 CORS origins are hardcoded in `main.ts`
| | |
|---|---|
| **What** | `app.enableCors()` in `main.ts` hardcodes two allowed origins: `http://localhost:5173` and the production S3 dashboard URL. Adding a new dashboard deployment (staging, a different region, a custom domain) requires a code change and redeploy. |
| **Why** | Not-yet-configurable. A `CORS_ORIGIN` env var exists in `.env.example` but is not wired into the `enableCors()` call. |
| **V2 path** | Read `process.env.CORS_ORIGINS` (comma-separated) in `AppConfigService` and pass to `enableCors({ origin: [...] })`. |
| **Severity** | Operational. New deployments require code changes. |

### 10.2 `DailyCloseJob` runs at 00:05 UTC — no timezone awareness
| | |
|---|---|
| **What** | The cron `5 0 * * *` always fires at 00:05 UTC. A tenant in UTC-8 (US Pacific) would see their "daily" latency stats close at 4:05 PM local time, meaning stats are slightly out of calendar-day alignment when viewed in a local timezone dashboard. |
| **Why** | Deliberate simplification. UTC is the correct choice for server-side time; the issue is presentation-layer. |
| **V2 path** | Store a `timezone` preference on the tenant. When rendering analytics, convert `usage_daily.date` to the tenant's timezone for display. The cron stays UTC — the mismatch is ±12 hours and is acceptable for analytics use cases. |
| **Severity** | Cosmetic for most use cases. |

### 10.3 Model pricing requires service restart to pick up new models
| | |
|---|---|
| **What** | New models added to `model_pricing` via `seed-dev.ts` or direct DB insert are invisible to `CostCalculatorService` until the service restarts (or `refreshPricing()` is called manually). Cost for unknown models is silently recorded as `$0.00` with a `logger.warn`. |
| **Why** | `onModuleInit()` loads pricing once. No scheduled refresh. |
| **V2 path** | Add `@Cron('0 */5 * * * *') async refreshPricing()` to `CostCalculatorService`, or expose `POST /api/v1/pricing/refresh` for an admin to trigger on-demand after seeding. |
| **Severity** | Operational. New models have incorrect (zero) cost tracking until restart. |

### 10.4 `x-no-cache` is read from the request body, not the request headers
| | |
|---|---|
| **What** | `CacheInterceptor` checks `body['x-no-cache']` for the cache-bypass flag. The API contracts doc lists it as a header alongside `x-provider` and `x-tag`, which are correctly read with `req.headers['x-provider']`. |
| **Why** | Inconsistency introduced during implementation. The DTO does not define `x-no-cache` as a body field either, so `whitelist: true` on the `ValidationPipe` strips it if passed as a body field. The header path (`req.headers['x-no-cache']`) is what the spec implies but is not what the interceptor reads. |
| **V2 path** | Move `body['x-no-cache']` to `req.headers['x-no-cache']` in `CacheInterceptor` to match the spec and the pattern used by every other `x-*` control header. |
| **Severity** | **Functional.** Callers who send `x-no-cache` as a header (the documented behaviour) cannot bypass the cache. They must send it as a body field, which is undocumented. |

---

## V2 Roadmap Summary

| # | Item | Area | Severity | Effort |
|---|------|------|----------|--------|
| 1.1 | Self-service onboarding (registration flow, billing) | Tenancy | Functional | L |
| 1.2 | Users table, RBAC, dashboard login | Tenancy | Functional | L |
| 1.3 | Org/team sub-tenant hierarchy | Tenancy | Functional | L |
| 1.4 | BYOK self-service (`PATCH /providers/:id/key`) | Tenancy | Functional | S |
| 1.5 | Per-API-key rate limits | Tenancy | Functional | M |
| **1.6** | **Enforce `monthly_spend_limit_usd` on provider_configs** | **Tenancy** | **Functional** | **S** |
| 2.1 | Additional provider adapters (Azure, Bedrock, Cohere…) | Providers | Cosmetic | S each |
| 2.2 | Provider fallback chains + circuit breaker (T65) | Providers | Functional | M |
| 2.3 | Multi-key load balancing per provider | Providers | Functional | M |
| 2.4 | Retry with jitter + circuit breaker for streaming | Providers | Functional | M |
| 2.5 | Lightweight Anthropic health probe | Providers | Cosmetic | S |
| 3.1 | Semantic cache via pgvector (Sprint S5) | Caching | Functional | L |
| **3.2** | **Wire `x-cache-ttl` header** | **Caching** | **Functional** | **S** |
| 3.3 | Cache invalidation API | Caching | Operational | S |
| 3.4 | Synchronous write option for high-frequency prompts | Caching | Cosmetic | M |
| 3.5 | Cache replay for streaming responses | Caching | Cosmetic | M |
| 4.1 | Accept one-request over-budget slip on budget boundary | Budgets | Cosmetic | — |
| 4.2 | Emergency rate-limit override endpoint | Budgets | Operational | S |
| 4.3 | Budget alert webhooks (Sprint S3, T67) | Budgets | Operational | M |
| 4.4 | Configurable billing cycle start day | Budgets | Functional | S |
| 5.1 | Opt-in encrypted content storage | Compliance | Functional | L |
| 5.2 | Server-side `userLabel` hashing option | Compliance | Compliance | S |
| 5.3 | Automated data retention / purge job | Compliance | Compliance | M |
| 5.4 | `DELETE /api/v1/tenants/:id` + cascade purge | Compliance | Compliance | M |
| 5.5 | Multi-region deployment + data residency routing | Compliance | Compliance | XL |
| 6.1 | Alert webhooks for budget / provider events | Observability | Operational | M |
| 6.2 | Redis degraded-mode fallback in AuthGuard | Observability | Functional | M |
| 6.3 | Periodic `refreshPricing()` cron | Observability | Operational | S |
| 7.1 | Zero-tolerance revocation via `revoked:{hash}` Redis SET | Security | Functional | S |
| 7.2 | Admin audit log table + API | Security | Compliance | M |
| 7.3 | Admin key table (rotate without restart) | Security | Security | M |
| 8.1 | ALB + multi-instance deployment | Scalability | Functional | M |
| 8.2 | Explicit Prisma connection pool sizing | Scalability | Functional | S |
| 8.3 | Separate Redis instances for BullMQ vs hot-path | Scalability | Functional | S |
| 9.1 | AbortController on client disconnect for streams | Streaming | Functional | M |
| 9.2 | Post-correct TPM window after actual token count arrives | Streaming | Functional | M |
| 10.1 | CORS origins from env var | Misc | Operational | S |
| 10.2 | Timezone-aware analytics display | Misc | Cosmetic | S |
| 10.3 | Periodic pricing refresh or admin endpoint | Misc | Operational | S |
| **10.4** | **Fix `x-no-cache` to read from headers, not body** | **Misc** | **Functional** | **S** |

**Effort key:** S = hours, M = 1–3 days, L = 1–2 weeks, XL = multi-week infrastructure project.

Items in **bold** are bugs (documented behaviour does not match implementation). All others are deliberate scope boundaries or deferred features.
