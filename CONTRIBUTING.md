# Contributing to LLM Gateway

## Development setup

```bash
# Prerequisites: Node 20, Docker

# 1. Clone and install
git clone <repo>
cd llm-gateway
nvm use          # reads .nvmrc → Node 20
npm install      # also installs Husky git hooks via `prepare` script

# 2. Start local services
docker compose -f docker-compose.local.yml up -d
# PostgreSQL on :5433 (avoids conflict with system postgres on :5432)
# Redis on :6379

# 3. Copy env
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, ADMIN_SECRET, ENCRYPTION_KEY

# 4. Run migrations + seed
npx prisma migrate dev
npx ts-node scripts/seed-dev.ts

# 5. Start dev server
npm run start:dev
```

## Project layout

```
src/
  app.module.ts              ← root module
  main.ts                    ← bootstrap
  common/
    guards/                  ← AuthGuard, AdminGuard, RateLimitGuard
    interfaces/              ← IProviderAdapter, AuthContext, etc.
    repositories/            ← BaseRepository
    utils/                   ← encryption, etc.
  modules/
    gateway/                 ← LLM request handler (see gateway/CLAUDE.md)
    providers/               ← adapter registry + provider configs (see providers/CLAUDE.md)
    cache/                   ← Redis exact-match cache (see cache/CLAUDE.md)
    rate-limit/              ← sliding-window rate limiting (see rate-limit/CLAUDE.md)
    router/                  ← provider/model resolution (see router/CLAUDE.md)
    analytics/               ← usage stats endpoints
    usage/                   ← BullMQ jobs, cost calculator, budget checker
    tenants/                 ← tenant CRUD (admin-only)
    api-keys/                ← key generation and revocation
    stream/                  ← SSE proxy
  health/                    ← /health and /health/ready
prisma/
  schema.prisma              ← DB schema
  migrations/                ← migration history (commit all of these)
docs/
  decisions/                 ← ADRs (ADR-001 through ADR-005)
.claude/
  commands/                  ← Claude slash commands for common tasks
  docs/                      ← architecture reference docs
```

## Code rules (enforced by CI)

- **No `any` type** — ever. Use `unknown` and narrow it.
- **No `console.log`** — use `new Logger(ClassName.name)` from `@nestjs/common`.
- **Every DB query scoped by `tenantId`** — BaseRepository enforces this for all tables
  except `tenants` and routing rules (documented exceptions in CLAUDE.md).
- **Every Redis key prefixed** with `tenant:{id}:`.
- **Raw API keys never stored** — hash ours (SHA-256), encrypt provider keys (AES-256-GCM).
- **No `any` in test files either** — use proper mocked types.

## Git hooks (Husky)

Three hooks run automatically:

| Hook | What it does |
|------|-------------|
| `pre-commit` | `lint-staged` (staged TS files only) + `npm run build` + console.log guard |
| `commit-msg` | Enforces conventional commit format |
| `pre-push` | Full `npm test` suite |

## Commit format

```
type(scope): short description

Types: feat | fix | docs | refactor | test | chore | perf
Scope: module name (gateway, providers, cache, rate-limit, etc.)

Examples:
  feat(gateway): add request retry with exponential backoff
  fix(cache): use of(null) instead of EMPTY on cache hit
  docs(providers): add gemini adapter quirks to CLAUDE.md
  refactor(router): extract matchesConditions to separate util
```

The `commit-msg` hook rejects commits that don't match this format.

## Testing

```bash
npm test                                   # all tests (~8s)
npm test -- --testPathPattern="gateway"   # single module
npm test -- --onlyChanged                 # changed files only
```

- Unit tests mock external dependencies (DB, Redis, provider SDKs)
- Integration tests for live provider APIs are skipped unless a real key is set
  (`const runTest = apiKey ? it : it.skip`)
- Tests go in `<module>.service.spec.ts` and `<module>.controller.spec.ts`
- Use `ioredis-mock` for Redis tests — it executes Lua natively

## Architecture decision records

Significant design decisions are documented in `docs/decisions/`. Read these before
making changes to the areas they cover:

| ADR | Covers |
|-----|--------|
| [ADR-001](docs/decisions/ADR-001-provider-adapter-pattern.md) | How provider adapters work |
| [ADR-002](docs/decisions/ADR-002-async-bullmq-tail.md) | Why all post-response work is async |
| [ADR-003](docs/decisions/ADR-003-redis-sliding-window-rate-limit.md) | Rate limit implementation |
| [ADR-004](docs/decisions/ADR-004-cache-key-async-population.md) | Cache key design |
| [ADR-005](docs/decisions/ADR-005-adminguard-authguard-separation.md) | Admin vs tenant guards |

## Pull request process

1. Branch from `dev`: `git checkout -b feat/my-feature`
2. Make changes; all hooks must pass on commit and push
3. Open PR against `dev` (not `main`)
4. PR description should reference the relevant task number (T-prefix) and any ADRs affected
5. `main` is the production branch — only merge from `dev` when deploying

## Security rules (never violate)

- `x-user-id` / `userLabel` must be an opaque token — never store emails or real identifiers
- Message content limits (100 messages, 1M chars) must not be raised without a security review
- `AdminGuard` protects management endpoints — never replace with `AuthGuard`
- Provider API keys are encrypted at rest — `getDecryptedApiKey()` is the only decrypt point

See the Security Rules section in [CLAUDE.md](CLAUDE.md) for the complete list.
