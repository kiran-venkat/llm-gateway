# Command: new-provider

Scaffold a new LLM provider adapter. Run this when adding support for a provider that is
not yet in the registry (OpenAI, Anthropic, Gemini are already implemented).

## Steps

### 1. Create the adapter directory

```
src/modules/providers/adapters/<name>/
  <name>.adapter.ts
  <name>.adapter.spec.ts
```

### 2. Implement IProviderAdapter

```typescript
import { IProviderAdapter } from '../../../../common/interfaces/provider-adapter.interface';
import { GatewayRequest } from '../../../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../../../common/dto/gateway-response.dto';
import { StreamChunk } from '../../../../common/dto/stream-chunk.dto';
import { GatewayError } from '../../../../common/dto/gateway-error.dto';

export class <Name>Adapter implements IProviderAdapter {
  complete(request: GatewayRequest, apiKey: string): Promise<GatewayResponse> { ... }
  async *completeStream(request: GatewayRequest, apiKey: string): AsyncGenerator<StreamChunk> { ... }
  estimateTokens(request: GatewayRequest): number { ... }
  mapError(err: unknown): GatewayError { ... }
}
```

Key rules (see `src/modules/providers/CLAUDE.md` and ADR-001):
- No constructor dependencies — adapters are instantiated with `new()`, not via DI
- `mapError()` must always return a `GatewayError`, never throw
- `estimateTokens()` is pure CPU — no async, no I/O
- `complete()` and `completeStream()` create their SDK client inline using `apiKey`

### 3. Register in ProvidersModule

In `src/modules/providers/providers.module.ts`, inside `onModuleInit()`:

```typescript
this.registry.register('<name>', new <Name>Adapter());
```

### 4. Add model pricing

In `scripts/seed-dev.ts`, add `modelPricing.upsert` entries for each model:

```typescript
await prisma.modelPricing.upsert({
  where: { provider_model: { provider: '<name>', model: '<model-id>' } },
  update: {},
  create: {
    provider: '<name>',
    model: '<model-id>',
    inputPricePerMToken: <price>,
    outputPricePerMToken: <price>,
  },
});
```

### 5. Add model prefix mapping (optional)

If the provider has a recognisable model prefix, add it to `MODEL_PREFIX_MAP` in
`src/modules/router/router.service.ts`. Shorter/more-specific prefixes must come first.

### 6. Write unit tests

```typescript
jest.mock('<sdk-package>');  // required — SDK creates instances at module level
```

Test: `complete()`, `completeStream()`, `estimateTokens()`, `mapError()` for each
error type the SDK can throw. Do not use real API keys in unit tests.

For integration tests: use the `const runTest = apiKey ? it : it.skip` pattern.

### 7. Update MODEL_PRICING_MAP in CostCalculatorService

If the provider has non-standard pricing tiers, verify `CostCalculatorService` loads the
new rows correctly on `onModuleInit()`.

## Checklist

- [ ] Adapter implements all 4 `IProviderAdapter` methods
- [ ] No constructor dependencies
- [ ] Registered in `ProvidersModule.onModuleInit()`
- [ ] Model pricing seeded in `seed-dev.ts`
- [ ] Unit tests pass with jest.mock
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
