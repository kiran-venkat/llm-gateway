# Command: run-checks

Run the full local quality gate in the same order as the pre-push git hook.

## Full check (same as pre-push)

```bash
# Lint all TypeScript files
npm run lint

# Build (TypeScript compile + Lua file copy)
npm run build

# Full test suite (~8s)
npm test
```

## Quick check (faster iteration)

```bash
# Build only — catches type errors fast
npm run build

# Tests for changed files only
npm test -- --onlyChanged --passWithNoTests
```

## Console.log audit

The pre-commit hook rejects `console.log` in `src/**/*.ts` (excluding spec files).
To check manually:

```bash
grep -rn "console\.log" src/ --include="*.ts" | grep -v "\.spec\.ts:"
```

## Type check without build output

```bash
npx tsc --noEmit
```

## Run a single test file

```bash
npm test -- --testPathPattern="gateway.service"
```

## Run tests matching a description

```bash
npm test -- --testNamePattern="should return 429"
```

## Check for unused exports (optional, not enforced by CI)

```bash
npx ts-prune
```

## Production readiness check

Before merging to main, verify:

```bash
# 1. All checks pass
npm run lint && npm run build && npm test

# 2. No security issues in dependencies
npm audit --audit-level=high

# 3. DB schema is in sync with Prisma schema
npx prisma validate

# 4. No pending migrations
npx prisma migrate status
```
