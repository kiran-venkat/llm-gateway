# ADR-001: Provider Adapter Registry Pattern

**Status:** Accepted  
**Date:** 2026-01-15  
**Deciders:** Core team

## Context

The gateway must route LLM requests to multiple providers (OpenAI, Anthropic, Gemini) whose
SDKs have entirely different client APIs, error shapes, message formats, and streaming
protocols. We needed a design that:

- Allows adding a new provider without touching routing, rate-limit, or billing logic
- Keeps provider SDK details (client instantiation, auth, error codes) fully isolated
- Supports unit-testing each adapter independently without a real API key
- Works within NestJS DI without making adapters themselves NestJS providers

## Decision

**Plugin/adapter pattern with a central registry.**

Each provider implements `IProviderAdapter`:

```typescript
interface IProviderAdapter {
  complete(request: GatewayRequest, apiKey: string): Promise<GatewayResponse>;
  completeStream(request: GatewayRequest, apiKey: string): AsyncGenerator<StreamChunk>;
  estimateTokens(request: GatewayRequest): number;
  mapError(err: unknown): GatewayError;
}
```

Adapters are instantiated with `new()` inside `ProvidersModule.onModuleInit()` and registered
into `AdapterRegistry` (a plain `Map<string, IProviderAdapter>`). They have no constructor
dependencies — any NestJS service they need must be injected into the module, not the adapter.

`AdapterRegistry` is a NestJS provider exported from `ProvidersModule`. All other modules
(`GatewayModule`, `RateLimitModule`) import `ProvidersModule` to access it.

## Consequences

**Good:**
- Adding a fourth provider requires only: new adapter file + one `registry.register()` call
- Adapter unit tests mock the SDK at the module level (`jest.mock('openai')`), no DI setup needed
- Routing, rate-limiting, caching, and billing all see a uniform `IProviderAdapter` interface
- `mapError()` on each adapter normalises provider-specific error shapes to `GatewayError`

**Watch out for:**
- Adapters must not be instantiated as NestJS providers (no `@Injectable()`) — they have no
  constructor params by design. If an adapter needs a NestJS service, refactor it as a proper
  NestJS provider and update `AdapterRegistry` accordingly.
- Named SDK exports matter for mocking: `import { APIError }` not `Anthropic.APIError`.
  See the Anthropic adapter decision note in CLAUDE.md.
- `GeminiAdapter.translateMessages()` is `public` specifically to allow direct unit testing
  of its alternating-turn enforcement logic.

## Affected modules

- `src/modules/providers/` — see [providers CLAUDE.md](../../src/modules/providers/CLAUDE.md)
- `src/modules/gateway/` — consumes `AdapterRegistry` for routing and token estimation
- `src/modules/rate-limit/` — consumes `AdapterRegistry` for `estimateTokens()` before RPM check
