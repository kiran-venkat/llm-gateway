# Providers Module

Owns provider adapter implementations, the adapter registry, and provider config CRUD.

## Sub-responsibilities

| Concern | Location |
|---------|----------|
| Adapter interface | `src/common/interfaces/provider-adapter.interface.ts` |
| Adapter implementations | `adapters/openai/`, `adapters/anthropic/`, `adapters/gemini/` |
| Adapter registry | `registry/adapter.registry.ts` |
| Provider config storage | `provider-configs.repository.ts` + `.service.ts` |
| Provider health probes | `provider-status.service.ts` |
| HTTP controllers | `provider-configs.controller.ts` |

## Adapter pattern (ADR-001)

Adapters are instantiated with `new()` in `ProvidersModule.onModuleInit()` — **not** as
NestJS providers. They have no constructor dependencies by design. If an adapter ever needs
a NestJS service, refactor it as a proper `@Injectable()` and update `AdapterRegistry`.

```typescript
// onModuleInit in providers.module.ts
this.registry.register('openai', new OpenAIAdapter());
this.registry.register('anthropic', new AnthropicAdapter());
this.registry.register('gemini', new GeminiAdapter());
```

See [ADR-001](../../../docs/decisions/ADR-001-provider-adapter-pattern.md).

## Per-provider quirks

**Anthropic:**
- `max_tokens` is required by the API. Default 1024 when caller omits it.
- System messages must be extracted from `messages[]` to top-level `system` string.
  Use `.find()` (first system message), not `.findLast()`.
- Import `APIError` as a named export, not `Anthropic.APIError` — named exports survive
  `jest.mock()`, namespace-style access does not.

**Gemini:**
- Requires strictly alternating user/model turns. `translateMessages()` inserts empty
  filler messages between consecutive same-role messages.
- `translateMessages()` is `public` specifically for direct unit testing.
- `mapError()` uses `string.includes()` — Gemini SDK surfaces errors as plain `Error`
  objects with status codes embedded in the message string, not structured error types.

**OpenAI:**
- Most permissive SDK; closest to the gateway's internal message format.

## Guard rules (ADR-005)

```
POST   /api/v1/providers            → AdminGuard  (uses AdminUpsertProviderConfigDto)
GET    /api/v1/providers            → AuthGuard
GET    /api/v1/providers/status     → AuthGuard
DELETE /api/v1/providers/:provider  → AdminGuard  (tenant_id in query param)
```

`@Get('status')` is declared **before** `@Delete(':provider')` to prevent Express matching
`GET /status` against the `/:provider` param route.

Admin endpoints use `AdminUpsertProviderConfigDto extends UpsertProviderConfigDto` — base
DTO is unchanged, no existing tests are affected.

See [ADR-005](../../../docs/decisions/ADR-005-adminguard-authguard-separation.md).

## Provider status probes

`ProviderStatusService.getStatus()` uses `Promise.allSettled` — one down provider must not
prevent reporting other providers' status. Results cached in Redis at
`tenant:{id}:providers:status` for 30s.

## Key files

| File | Purpose |
|------|---------|
| `adapters/openai/openai.adapter.ts` | OpenAI SDK wrapper |
| `adapters/anthropic/anthropic.adapter.ts` | Anthropic SDK wrapper, system-message extraction |
| `adapters/gemini/gemini.adapter.ts` | Gemini SDK wrapper, alternating-turn enforcement |
| `registry/adapter.registry.ts` | `Map<string, IProviderAdapter>` with register/get |
| `provider-configs.repository.ts` | Encrypted API key storage and retrieval |
| `provider-status.service.ts` | Live provider health probes |
| `dto/admin-upsert-provider-config.dto.ts` | Extends base DTO with `tenant_id` for admin use |

## Adding a new provider

See [`.claude/commands/new-provider.md`](../../../.claude/commands/new-provider.md).

## Related ADRs

- [ADR-001](../../../docs/decisions/ADR-001-provider-adapter-pattern.md) — adapter registry pattern
- [ADR-005](../../../docs/decisions/ADR-005-adminguard-authguard-separation.md) — admin vs tenant guards
