import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKey, Tenant } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import { hashApiKey } from '../utils/hash.util';
import { ApiKeysRepository } from '../../modules/api-keys/api-keys.repository';
import { TenantsService } from '../../modules/tenants/tenants.service';
import { AuthContext } from '../interfaces/auth-context.interface';
import { AuthGuard } from './auth.guard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-111-222-333';
const KEY_ID = 'key-aaa-bbb-ccc';
const RAW_KEY = 'lgk_' + 'a'.repeat(64);
const KEY_HASH = hashApiKey(RAW_KEY);

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: KEY_ID,
    tenantId: TENANT_ID,
    keyHash: KEY_HASH,
    keyPrefix: RAW_KEY.slice(0, 16),
    name: 'test key',
    isActive: true,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_ID,
    name: 'Acme',
    slug: 'acme',
    plan: 'pro',
    monthlyBudgetUsd: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const req = { headers, tenant: undefined };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeMockRepo(): jest.Mocked<ApiKeysRepository> {
  return {
    findByKeyHash: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findActiveByTenant: jest.fn(),
  } as unknown as jest.Mocked<ApiKeysRepository>;
}

function makeMockTenantsService(): jest.Mocked<TenantsService> {
  return {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<TenantsService>;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('AuthGuard', () => {
  let redis: InstanceType<typeof RedisMock>;
  let repo: jest.Mocked<ApiKeysRepository>;
  let tenantsService: jest.Mocked<TenantsService>;
  let guard: AuthGuard;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
    repo = makeMockRepo();
    tenantsService = makeMockTenantsService();
    // AuthGuard constructor args match the order of @InjectRedis(), repo, service
    guard = new AuthGuard(redis as never, repo, tenantsService);
  });

  // -------------------------------------------------------------------------
  // Authorization header extraction
  // -------------------------------------------------------------------------

  describe('Authorization header', () => {
    it('throws 401 when Authorization header is missing', async () => {
      const ctx = makeContext({});
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when header has no Bearer prefix', async () => {
      const ctx = makeContext({ authorization: RAW_KEY });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when header is "Bearer " with nothing after', async () => {
      const ctx = makeContext({ authorization: 'Bearer ' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when header is "Basic ..." (wrong scheme)', async () => {
      const ctx = makeContext({ authorization: `Basic ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Redis cache hit
  // -------------------------------------------------------------------------

  describe('Redis cache hit', () => {
    const cachedContext: AuthContext = {
      tenantId: TENANT_ID,
      apiKeyId: KEY_ID,
      plan: 'pro',
    };

    beforeEach(async () => {
      await redis.set(
        `auth:hash:${KEY_HASH}`,
        JSON.stringify(cachedContext),
        'EX',
        300,
      );
    });

    it('returns true on cache hit', async () => {
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('attaches the cached AuthContext to the request', async () => {
      const req = {
        headers: { authorization: `Bearer ${RAW_KEY}` },
        tenant: undefined,
      };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);

      expect(req.tenant).toEqual(cachedContext);
    });

    it('does NOT call the database on a cache hit', async () => {
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await guard.canActivate(ctx);
      expect(repo.findByKeyHash).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DB lookup path (cache miss)
  // -------------------------------------------------------------------------

  describe('cache miss — DB lookup', () => {
    beforeEach(() => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey());
      tenantsService.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(makeApiKey());
    });

    it('returns true for a valid key', async () => {
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('attaches AuthContext to the request', async () => {
      const req = {
        headers: { authorization: `Bearer ${RAW_KEY}` },
        tenant: undefined,
      };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);

      expect(req.tenant).toMatchObject<AuthContext>({
        tenantId: TENANT_ID,
        apiKeyId: KEY_ID,
        plan: 'pro',
      });
    });

    it('stores the AuthContext in Redis after DB lookup', async () => {
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await guard.canActivate(ctx);

      const stored = await redis.get(`auth:hash:${KEY_HASH}`);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as AuthContext;
      expect(parsed.tenantId).toBe(TENANT_ID);
    });

    it('calls findByKeyHash with the SHA-256 hash of the raw token', async () => {
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await guard.canActivate(ctx);
      expect(repo.findByKeyHash).toHaveBeenCalledWith(KEY_HASH);
    });

    it('throws 401 when key hash is not found in DB', async () => {
      repo.findByKeyHash.mockResolvedValue(null);
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Key validation
  // -------------------------------------------------------------------------

  describe('revoked key', () => {
    it('throws 401 when isActive is false', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey({ isActive: false }));
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('expired key', () => {
    it('throws 401 when expiresAt is in the past', async () => {
      repo.findByKeyHash.mockResolvedValue(
        makeApiKey({ expiresAt: new Date('2020-01-01') }),
      );
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows a key with expiresAt in the future', async () => {
      repo.findByKeyHash.mockResolvedValue(
        makeApiKey({ expiresAt: new Date('2099-01-01') }),
      );
      tenantsService.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(makeApiKey());
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('allows a key with null expiresAt (no expiry)', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey({ expiresAt: null }));
      tenantsService.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(makeApiKey());
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Tenant validation
  // -------------------------------------------------------------------------

  describe('suspended tenant', () => {
    it('throws 401 when tenant isActive is false', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey());
      tenantsService.findById.mockResolvedValue(
        makeTenant({ isActive: false }),
      );
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when TenantsService throws (tenant not found)', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey());
      tenantsService.findById.mockRejectedValue(new Error('not found'));
      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // last_used_at fire-and-forget
  // -------------------------------------------------------------------------

  describe('last_used_at update', () => {
    it('calls repo.update with lastUsedAt without blocking canActivate', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey());
      tenantsService.findById.mockResolvedValue(makeTenant());
      // Resolve immediately — just checking it's called, not awaited
      repo.update.mockResolvedValue(makeApiKey());

      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      // Give the event loop a full tick to flush the fire-and-forget promise chain
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        KEY_ID,
        expect.objectContaining({ lastUsedAt: expect.any(Date) as Date }),
      );
    });

    it('does not throw if last_used_at update fails', async () => {
      repo.findByKeyHash.mockResolvedValue(makeApiKey());
      tenantsService.findById.mockResolvedValue(makeTenant());
      repo.update.mockRejectedValue(new Error('DB down'));

      const ctx = makeContext({ authorization: `Bearer ${RAW_KEY}` });
      // canActivate must resolve true even if the update fails
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
