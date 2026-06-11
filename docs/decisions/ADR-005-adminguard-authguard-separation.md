# ADR-005: AdminGuard / AuthGuard Separation

**Status:** Accepted  
**Date:** 2026-06-10  
**Deciders:** Core team

## Context

The gateway has two distinct classes of caller:

1. **Tenants** — application developers who send LLM requests using their API keys.
   They should only access their own data and LLM endpoints.
2. **Operators** — infrastructure/platform team who provision tenants, configure provider
   credentials, and create API keys. They authenticate with a shared admin secret.

A single guard for both would either (a) grant tenants access to admin operations, or
(b) require operators to hold a tenant API key to do provisioning — which is circular
(a key must exist before it can be used to create more keys).

## Decision

**Two completely separate guards. Never mix them.**

### `AuthGuard` (`src/common/guards/auth.guard.ts`)
- Validates `Authorization: Bearer lgk_<key>` against `api_keys` table (SHA-256 hash)
- On success: populates `req.tenant` with `{ tenantId, keyId }` via `@TenantContext()`
- Used on: LLM endpoints, GET analytics, GET provider configs/status, GET/DELETE API keys

### `AdminGuard` (`src/common/guards/admin.guard.ts`)
- Validates `Authorization: Bearer <ADMIN_SECRET>` against `config.adminSecret`
- On success: returns `true`. **Does not set `req.tenant`.**
- Used on: POST/DELETE providers, POST/PATCH/GET tenants, POST API keys
- 401 if no Bearer header, 403 if wrong secret (deliberate: distinguish missing vs wrong)

### The bootstrap problem

A tenant cannot create their own first API key — they would need a key to authenticate
the creation request. `AdminGuard` on `POST /api/v1/keys` breaks this circularity:
an operator creates the first key; the tenant uses it for everything after that.

### Controller guard strategy

Avoid class-level `@UseGuards()` on split-auth controllers. Apply guards per-method:

```
ProviderConfigsController:
  POST   /providers         → @UseGuards(AdminGuard)  + AdminUpsertProviderConfigDto
  GET    /providers         → @UseGuards(AuthGuard)
  GET    /providers/status  → @UseGuards(AuthGuard)
  DELETE /providers/:name   → @UseGuards(AdminGuard)  + ?tenant_id query param

ApiKeysController:
  POST   /keys              → @UseGuards(AdminGuard)  + AdminCreateApiKeyDto
  GET    /keys              → @UseGuards(AuthGuard)
  DELETE /keys/:id          → @UseGuards(AuthGuard)

TenantsController:           @UseGuards(AdminGuard) at class level (all routes admin-only)
```

### DTO inheritance for admin endpoints

Admin endpoints need a `tenant_id` field that tenant endpoints must not expose.
Admin DTOs extend the base DTO: `AdminUpsertProviderConfigDto extends UpsertProviderConfigDto`.
Base DTOs are unchanged — all existing service tests compile without modification.

## Consequences

**Good:**
- `AuthGuard` and `AdminGuard` cannot interfere with each other — different headers,
  different secrets, different req properties
- `@TenantContext()` is only meaningful after `AuthGuard` runs. Admin routes never use it.
- Adding a new admin endpoint requires only `@UseGuards(AdminGuard)` — no ADMIN_SECRET
  management in service or repository layers

**Never do:**
- Add `AuthGuard` to a management endpoint (tenants must not provision their own resources)
- Add `AdminGuard` to a tenant endpoint (operators should not impersonate tenants)
- Check `req.tenant` in an admin handler (it will be undefined — AdminGuard never sets it)
- Store or log the admin secret

## Affected modules

- `src/common/guards/` — `admin.guard.ts`, `auth.guard.ts`
- `src/modules/providers/` — see [providers CLAUDE.md](../../src/modules/providers/CLAUDE.md)
- `src/modules/api-keys/` — see [api-keys CLAUDE.md](../../src/modules/api-keys/CLAUDE.md)
- `src/modules/tenants/` — see [tenants CLAUDE.md](../../src/modules/tenants/CLAUDE.md)
