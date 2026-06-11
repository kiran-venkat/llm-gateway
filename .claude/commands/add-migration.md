# Command: add-migration

Add a Prisma schema change and create a new migration.

## Workflow

### 1. Edit the Prisma schema

```
prisma/schema.prisma
```

Rules:
- UUID fields: `String @db.Uuid` not `UUID`
- FK scalar fields must be declared **before** their `@relation` lines
- Every new table (except `tenants`) needs a `tenantId String @db.Uuid` column
- Add a comment above any PII-sensitive field (see `userLabel` in `RequestSpan` for example)

### 2. Generate and apply migration locally

```bash
# Creates a migration file and applies it to the local DB
npx prisma migrate dev --name <descriptive-name>

# Examples:
npx prisma migrate dev --name add-retention-days-to-tenants
npx prisma migrate dev --name add-cache-entries-hit-count
```

Migration files are created in `prisma/migrations/<timestamp>_<name>/migration.sql`.
Commit the migration file alongside the schema change.

### 3. Regenerate Prisma client

`prisma migrate dev` does this automatically. If you only changed the schema without
migrating (e.g. for a dry run):

```bash
npx prisma generate
```

### 4. Update seed script if needed

If you added a new table or new required data (e.g. model pricing rows), update
`scripts/seed-dev.ts`.

### 5. Deploy migration to production

Run migrations **before** deploying code that depends on new columns/tables:

```bash
DATABASE_URL=postgresql://gateway:GatewayProd2026Secure@llm-gateway-db.c9yy6u48ofas.ap-south-1.rds.amazonaws.com:5432/llmgateway \
  npx prisma migrate deploy
```

See the full production deployment guide: [`.claude/commands/deploy.md`](./deploy.md)

## Common patterns

### Add a nullable column to an existing table

```prisma
model Tenant {
  // existing fields...
  retentionDays Int @default(90)
}
```

```bash
npx prisma migrate dev --name add-retention-days-to-tenants
```

### Add a new index

```prisma
model Request {
  @@index([tenantId, createdAt(sort: Desc)])
}
```

Indexes are created in the migration automatically. For large production tables,
consider using `CREATE INDEX CONCURRENTLY` manually rather than the migration,
to avoid table locks.

### Add a new table

1. Define the model in `schema.prisma`
2. If it stores tenant data, include `tenantId String @db.Uuid`
3. Create a corresponding `BaseRepository` subclass
4. Run `npx prisma migrate dev --name add-<table-name>`

## Checklist

- [ ] Schema change is backward-compatible (or migration order is planned)
- [ ] Migration file generated and committed
- [ ] `npx prisma validate` passes
- [ ] Seed script updated if new required data
- [ ] New PII-sensitive columns have a comment in schema.prisma
- [ ] Repository and service code updated for new fields
- [ ] Tests updated
- [ ] Production migration plan noted (before or after code deploy)
