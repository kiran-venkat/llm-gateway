# Command: new-module

Scaffold a new NestJS feature module following the project's established pattern.

## Directory structure

```
src/modules/<name>/
  <name>.module.ts        ← NestJS module, wires DI
  <name>.service.ts       ← business logic, no Prisma
  <name>.repository.ts    ← all DB access, extends BaseRepository
  <name>.controller.ts    ← HTTP layer only, no business logic
  <name>.controller.spec.ts
  <name>.service.spec.ts
  dto/
    create-<name>.dto.ts
```

## Module template

```typescript
// <name>.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { <Name>Controller } from './<name>.controller';
import { <Name>Service } from './<name>.service';
import { <Name>Repository } from './<name>.repository';

@Module({
  imports: [PrismaModule],
  controllers: [<Name>Controller],
  providers: [<Name>Service, <Name>Repository],
  exports: [<Name>Service],
})
export class <Name>Module {}
```

## Repository template

```typescript
// <name>.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../common/repositories/base.repository';
import { Prisma, <PrismaModel> } from '@prisma/client';

@Injectable()
export class <Name>Repository extends BaseRepository<<PrismaModel>, Prisma.<PrismaModel>Delegate> {
  constructor(prisma: PrismaService) {
    super(prisma.<modelName>);
  }
}
```

**Exception:** Do NOT extend BaseRepository if the model:
- Has no `tenantId` column (e.g. `Tenant` itself — see `TenantsRepository`)
- Needs NULL-aware tenant queries (e.g. global routing rules — see `RouterRepository`)

## Rules

- **No `any` types** — ever
- **No `console.log`** — use `private readonly logger = new Logger(<Name>Service.name)`
- **Every DB query scoped by tenantId** — BaseRepository enforces this automatically
- **Every Redis key prefixed** with `tenant:{id}:`
- Controller has no business logic — delegates to service
- Service has no Prisma imports — delegates to repository

## Guard selection (ADR-005)

- Tenant-facing endpoints: `@UseGuards(AuthGuard)` + `@TenantContext() ctx: AuthContext`
- Admin-only endpoints: `@UseGuards(AdminGuard)` — no `@TenantContext()`, tenantId from body/query
- Mixed controllers: per-method guards, no class-level guard

See [ADR-005](../../docs/decisions/ADR-005-adminguard-authguard-separation.md).

## Register in AppModule

Add `<Name>Module` to the `imports` array in `src/app.module.ts`.

## Checklist

- [ ] Module, service, repository, controller created
- [ ] Module registered in `app.module.ts`
- [ ] All DB queries use BaseRepository (or have documented reason not to)
- [ ] Logger used instead of console.log
- [ ] Controller spec + service spec written
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
