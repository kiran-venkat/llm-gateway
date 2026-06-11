# Current Sprint State

## Project status

V1 complete (T01–T56, 474 tests passing, 3 skipped).
Sprint S1 complete (T57–T59) — V1 gap fixes.
Sprint S2 in progress (T60–T66) — Deep observability.

## Last completed task

**T62 — p95 via Redis latency samples**

- `UsageJob` now writes `ZADD tenant:{id}:latency:{provider}:{model}:{date}` after each request.
- `DailyCloseJob` added at `src/modules/usage/jobs/daily-close.job.ts` — runs via BullMQ cron at 00:05 UTC, reads the previous day's sorted set, computes exact p95, upserts into `usage_daily.p95LatencyMs`. Redis key TTL: 48 hours.
- ADL entry added to CLAUDE.md: "DailyCloseJob owns p95 computation, not UsageJob."

Before T62:
- T60 ✅ — `RequestSpan` Prisma model + migration: `(tenantId, sessionId)` index, FK to `requests`.
- T61 ✅ — `x-session-id` / `x-user-id` headers wired through `GatewayRequest` DTO → `AuthContext` → `UsageJob` → `RequestSpan` write.

## What's next

**T63 — Latency analytics API** (Sprint S2, first planned task)

Adds `GET /api/v1/analytics/latency` returning p50/p95/p99 by provider+model per day.
- New `AnalyticsRepository.getLatencyBreakdown()` querying `usage_daily`.
- `?from=&to=` date filter. Returns `LatencyByProvider[]` with daily time-series.
- Modules: `AnalyticsRepository`, `AnalyticsService`, `AnalyticsController`.

After T63:
- T64 — Error analytics API (`GET /api/v1/analytics/errors`, queries `requests` not `usage_daily`).
- T65 — Circuit-breaker state in Redis, wired into `RateLimitGuard` and `UsageJob`.
- T66 — Dashboard latency page + session trace view.

## Sprint S2 remaining tasks

| Task | Title                      | Status  |
|------|----------------------------|---------|
| T60  | RequestSpan model          | ✅ done |
| T61  | Session headers in gateway | ✅ done |
| T62  | p95 via Redis samples      | ✅ done |
| T63  | Latency analytics API      | planned |
| T64  | Error analytics API        | planned |
| T65  | Circuit-breaker state      | planned |
| T66  | Dashboard: latency+session | planned |

## Future sprints (all planned)

- S3 (T67–T73): Budget intelligence — webhooks, forecasting, per-provider budgets, anomaly detection.
- S4 (T74–T81): AI control plane — Claude agent rewrites routing rules autonomously. Portfolio centrepiece.
- S5 (T82–T86): Semantic cache — pgvector embeddings, similarity search. Needs real traffic data first.

## Active decisions / blockers

None. Clean state after T62.

ADL warning to track: T59 retry loop uses fixed 500ms delay for a single retry. Before S4 (agent-driven provider switching), a proper per-provider circuit-breaker (CLOSED/OPEN/HALF_OPEN) must be in Redis. T65 closes this.
