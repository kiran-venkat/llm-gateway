# Router Module

Resolves which provider + model to use for each incoming request via a 5-step waterfall.

## Resolution waterfall

`RouterService.resolve(tenantId, request)` returns `{ provider, model }`:

```
1. Explicit override   — request.provider + request.model both set → use as-is
2. Explicit provider   — request.provider set, model inferred from MODEL_PREFIX_MAP
3. Routing rules       — query DB for rules matching (tenantId OR global), test conditions
4. MODEL_PREFIX_MAP    — prefix-match request.model to a provider
5. Default             — fall back to 'openai' + request.model
```

Routing rules are tenant-specific (tenantId set) or global (tenantId = NULL). The query
uses `OR [{tenantId}, {tenantId: null}]` — BaseRepository's mandatory tenantId scoping
cannot express this, so `RouterRepository` uses raw Prisma directly.

## RouterRepository does not extend BaseRepository

`RouterRepository` is the only repository that queries with NULL-aware tenant logic. Do not
refactor it to extend `BaseRepository` — the base class enforces mandatory tenantId and
would generate `WHERE id = $1 AND tenant_id = $2`, which is wrong for global rules.

## MODEL_PREFIX_MAP is order-dependent

`RouterService.resolve()` iterates `MODEL_PREFIX_MAP` and returns on the first matching
prefix. The `'o1'` entry must appear before any prefix that could accidentally match it.
When adding new OpenAI model families, shorter/more-specific prefixes must come first.

## matchesConditions() semantics

- `null`, `undefined`, or `{}` conditions → matches every request (catch-all)
- Conditions use AND logic: all specified fields must match; absent fields are skipped
- If `request.maxTokens` is undefined and a rule has `max_tokens_gt`/`max_tokens_lt`,
  the rule is silently skipped — a request with no token constraint cannot satisfy a
  token-based rule. This is intentional.

## Key files

| File | Purpose |
|------|---------|
| `router.service.ts` | 5-step waterfall + `matchesConditions()` |
| `router.repository.ts` | NULL-aware routing rule query (raw Prisma) |
| `router.module.ts` | Exports `RouterService` — imported by `GatewayModule` and `CacheModule` |

## CacheInterceptor dependency

`CacheInterceptor` calls `RouterService.resolve()` before building the cache key — the
provider + model are part of the cache key. `RouterModule` must therefore be imported in
`CacheModule` as well as `GatewayModule`.

## Routing rules schema

```
routing_rules: {
  tenantId: string | null   ← null = global rule
  priority: int             ← lower number = higher priority
  conditions: {
    model_pattern?: string  ← regex or prefix
    max_tokens_gt?: number
    max_tokens_lt?: number
  }
  targetProvider: string
  targetModel: string
}
```
