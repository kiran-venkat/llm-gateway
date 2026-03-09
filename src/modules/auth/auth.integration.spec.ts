/**
 * Auth integration test — full round-trip with real service instances.
 *
 * No mocked methods. No NestJS module system. All classes are instantiated
 * directly with in-memory Prisma delegates (no real DB, no real Redis).
 *
 * What this proves that unit tests cannot:
 * - The full Bearer → hash → Redis → DB → AuthContext pipeline works end-to-end
 * - Cache is populated after the first authenticated request
 * - A second request is served entirely from cache (no DB call)
 * - Revoking a key clears the Redis cache entry immediately
 * - A subsequent request with the revoked key hits the DB and gets a 401
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKey, Tenant } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import { randomUUID } from 'crypto';
import { hashApiKey } from '../../common/utils/hash.util';
import { AUTH_CACHE_PREFIX } from '../../common/constants/redis-keys';
import { PrismaDelegate } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeysRepository } from '../api-keys/api-keys.repository';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { TenantsRepository } from '../tenants/tenants.repository';
import { TenantsService } from '../tenants/tenants.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

// ---------------------------------------------------------------------------
// In-memory Prisma delegates
// ---------------------------------------------------------------------------

/**
 * Returns a PrismaDelegate<T> that stores records in a plain array.
 * Supports the subset of Prisma operations used by our repositories:
 * findFirst, findMany, create (auto-id), update, delete.
 */
function makeInMemoryDelegate<T extends Record<string, unknown>>(
  defaults: () => Partial<T>,
): PrismaDelegate<T> & { store: T[] } {
  const store: T[] = [];

  function matches(record: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => record[k] === v);
  }

  return {
    store,

    async findFirst({ where }) {
      return store.find((r) => matches(r, where)) ?? null;
    },

    async findMany({ where }) {
      return store.filter((r) => matches(r, where));
    },

    async create({ data }) {
      const record = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...defaults(),
        ...data,
      } as T;
      store.push(record);
      return record;
    },

    async update({ where, data }) {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx === -1) throw new Error('Record not found in in-memory store');
      store[idx] = { ...store[idx], ...data };
      return store[idx];
    },

    async delete({ where }) {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx !== -1) store.splice(idx, 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(token: string): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; tenant?: AuthContext };
} {
  const req = {
    headers: { authorization: `Bearer ${token}` },
    tenant: undefined,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Auth integration — full round-trip', () => {
  let redis: InstanceType<typeof RedisMock>;
  let apiKeysRepo: ApiKeysRepository;
  let apiKeysService: ApiKeysService;
  let tenantsService: TenantsService;
  let guard: AuthGuard;

  let tenantId: string;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();

    // ── Tenant side ──────────────────────────────────────────────────────────
    const tenantDelegate = makeInMemoryDelegate<Tenant>(() => ({
      isActive: true,
      plan: 'pro',
      monthlyBudgetUsd: null,
      slug: '',
      name: '',
    }));
    const tenantRepo = new TenantsRepository({
      tenant: tenantDelegate,
    } as unknown as PrismaService);
    tenantsService = new TenantsService(tenantRepo);

    // ── ApiKey side ───────────────────────────────────────────────────────────
    const apiKeyDelegate = makeInMemoryDelegate<ApiKey>(() => ({
      isActive: true,
      lastUsedAt: null,
      expiresAt: null,
      name: null,
      keyHash: '',
      keyPrefix: '',
      tenantId: '',
    }));
    apiKeysRepo = new ApiKeysRepository({
      apiKey: apiKeyDelegate,
    } as unknown as PrismaService);
    apiKeysService = new ApiKeysService(apiKeysRepo, redis as never);

    // ── Guard ─────────────────────────────────────────────────────────────────
    guard = new AuthGuard(redis as never, apiKeysRepo, tenantsService);

    // Seed a tenant for all tests in this suite
    const tenant = await tenantsService.create({
      name: 'Acme Corp',
      slug: 'acme',
      plan: 'pro',
    });
    tenantId = tenant.id;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Main round-trip
  // ─────────────────────────────────────────────────────────────────────────

  it('full round-trip: generate → auth → cache hit → revoke → 401', async () => {
    // 1. Generate a real API key via the service
    const { key: rawKey, id: keyId } = await apiKeysService.generate(
      tenantId,
      { name: 'integration-test-key' },
    );
    const keyHash = hashApiKey(rawKey);
    const cacheKey = `${AUTH_CACHE_PREFIX}${keyHash}`;

    // 2. First request — cache miss → DB lookup
    const findByHashSpy = jest.spyOn(apiKeysRepo, 'findByKeyHash');
    const { ctx: ctx1, req: req1 } = makeCtx(rawKey);

    await expect(guard.canActivate(ctx1)).resolves.toBe(true);

    expect(req1.tenant).toMatchObject<AuthContext>({
      tenantId,
      apiKeyId: keyId,
      plan: 'pro',
    });
    expect(findByHashSpy).toHaveBeenCalledTimes(1);
    expect(findByHashSpy).toHaveBeenCalledWith(keyHash);

    // 3. Redis cache is populated after the first request
    const cachedRaw = await redis.get(cacheKey);
    expect(cachedRaw).not.toBeNull();
    const cached = JSON.parse(cachedRaw!) as AuthContext;
    expect(cached.tenantId).toBe(tenantId);
    expect(cached.apiKeyId).toBe(keyId);

    // 4. Second request — cache hit, DB not touched
    findByHashSpy.mockClear();
    const { ctx: ctx2, req: req2 } = makeCtx(rawKey);

    await expect(guard.canActivate(ctx2)).resolves.toBe(true);

    expect(findByHashSpy).not.toHaveBeenCalled();
    expect(req2.tenant).toMatchObject({ tenantId, apiKeyId: keyId });

    // 5. Revoke the key — cache entry must be deleted immediately
    await apiKeysService.revoke(tenantId, keyId);

    const afterRevoke = await redis.get(cacheKey);
    expect(afterRevoke).toBeNull();

    // 6. Third request — cache miss → DB returns revoked key → 401
    findByHashSpy.mockClear();
    const { ctx: ctx3 } = makeCtx(rawKey);

    await expect(guard.canActivate(ctx3)).rejects.toThrow(
      UnauthorizedException,
    );
    // Guard went to the DB (cache was cleared by revoke)
    expect(findByHashSpy).toHaveBeenCalledTimes(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Revoke only clears the correct key's cache entry
  // ─────────────────────────────────────────────────────────────────────────

  it('revoking one key does not clear another keys cache', async () => {
    const { key: rawKeyA, id: idA } = await apiKeysService.generate(tenantId, {
      name: 'key-a',
    });
    const { key: rawKeyB, id: idB } = await apiKeysService.generate(tenantId, {
      name: 'key-b',
    });

    // Prime both keys into the cache
    const { ctx: ctxA } = makeCtx(rawKeyA);
    const { ctx: ctxB } = makeCtx(rawKeyB);
    await guard.canActivate(ctxA);
    await guard.canActivate(ctxB);

    const cacheKeyA = `${AUTH_CACHE_PREFIX}${hashApiKey(rawKeyA)}`;
    const cacheKeyB = `${AUTH_CACHE_PREFIX}${hashApiKey(rawKeyB)}`;
    expect(await redis.get(cacheKeyA)).not.toBeNull();
    expect(await redis.get(cacheKeyB)).not.toBeNull();

    // Revoke only key A
    await apiKeysService.revoke(tenantId, idA);

    // Key A's cache is gone, key B's is intact
    expect(await redis.get(cacheKeyA)).toBeNull();
    expect(await redis.get(cacheKeyB)).not.toBeNull();

    // Key B still authenticates successfully (from cache)
    const { ctx: ctxB2 } = makeCtx(rawKeyB);
    await expect(guard.canActivate(ctxB2)).resolves.toBe(true);

    void idB; // used above
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Revoke of non-existent key
  // ─────────────────────────────────────────────────────────────────────────

  it('revoking a non-existent key throws 404', async () => {
    await expect(
      apiKeysService.revoke(tenantId, randomUUID()),
    ).rejects.toThrow();
  });
});
