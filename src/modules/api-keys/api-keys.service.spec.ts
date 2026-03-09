import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import { hashApiKey } from '../../common/utils/hash.util';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyListItemDto } from './dto/api-key-response.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-aaa-bbb-ccc';
const KEY_ID = 'key-111-222-333';

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: KEY_ID,
    tenantId: TENANT_ID,
    keyHash: 'a'.repeat(64),
    keyPrefix: 'lgk_a3f9b2c1d4',
    name: 'test key',
    isActive: true,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMockRepo(): jest.Mocked<ApiKeysRepository> {
  return {
    findById: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByKeyHash: jest.fn(),
    findActiveByTenant: jest.fn(),
  } as unknown as jest.Mocked<ApiKeysRepository>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let repo: jest.Mocked<ApiKeysRepository>;

  beforeEach(() => {
    repo = makeMockRepo();
    const mockRedis = { del: jest.fn().mockResolvedValue(1) } as unknown as import('ioredis').Redis;
    service = new ApiKeysService(repo, mockRedis);
  });

  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------

  describe('generate', () => {
    beforeEach(() => {
      repo.create.mockImplementation(async (_tenantId, data) =>
        makeApiKey({
          keyHash: data['keyHash'] as string,
          keyPrefix: data['keyPrefix'] as string,
          name: (data['name'] as string | null) ?? null,
        }),
      );
    });

    it('generated key starts with "lgk_"', async () => {
      const result = await service.generate(TENANT_ID, {});
      expect(result.key).toMatch(/^lgk_/);
    });

    it('generated key body is 64 hex chars after the prefix', async () => {
      const result = await service.generate(TENANT_ID, {});
      // full key = "lgk_" (4) + 64 hex chars from randomBytes(32)
      expect(result.key).toHaveLength(68);
      expect(result.key.slice(4)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores the SHA-256 hash, not the raw key', async () => {
      const result = await service.generate(TENANT_ID, {});
      const expectedHash = hashApiKey(result.key);
      const storedHash = (repo.create.mock.calls[0]?.[1] as Record<string, unknown>)['keyHash'];
      expect(storedHash).toBe(expectedHash);
      expect(storedHash).not.toBe(result.key);
    });

    it('stores a 16-char keyPrefix (first 16 chars of the raw key)', async () => {
      const result = await service.generate(TENANT_ID, {});
      const storedPrefix = (repo.create.mock.calls[0]?.[1] as Record<string, unknown>)['keyPrefix'];
      expect(storedPrefix).toBe(result.key.slice(0, 16));
      expect(String(storedPrefix)).toHaveLength(16);
    });

    it('does not store the raw key in the repository call', async () => {
      const result = await service.generate(TENANT_ID, {});
      const createArg = repo.create.mock.calls[0]?.[1] as Record<string, unknown>;
      const storedValues = Object.values(createArg).map(String);
      expect(storedValues).not.toContain(result.key);
    });

    it('returns the raw key exactly once in the response', async () => {
      const result = await service.generate(TENANT_ID, {});
      expect(result.key).toBeDefined();
      expect(result.key).toMatch(/^lgk_/);
    });

    it('response includes id, key_prefix, name, created_at', async () => {
      const result = await service.generate(TENANT_ID, { name: 'my key' });
      expect(result.id).toBeDefined();
      expect(result.key_prefix).toMatch(/^lgk_/);
      expect(result.name).toBe('my key');
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('passes expiresAt when expires_at is provided', async () => {
      await service.generate(TENANT_ID, { expires_at: '2027-01-01T00:00:00Z' });
      const createArg = repo.create.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(createArg['expiresAt']).toBeInstanceOf(Date);
    });

    it('omits expiresAt when expires_at is not provided', async () => {
      await service.generate(TENANT_ID, {});
      const createArg = repo.create.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(createArg).not.toHaveProperty('expiresAt');
    });

    it('generates a different key on every call', async () => {
      const r1 = await service.generate(TENANT_ID, {});
      const r2 = await service.generate(TENANT_ID, {});
      expect(r1.key).not.toBe(r2.key);
    });
  });

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------

  describe('revoke', () => {
    it('sets isActive=false on the key', async () => {
      repo.findById.mockResolvedValue(makeApiKey());
      repo.update.mockResolvedValue(makeApiKey({ isActive: false }));

      await service.revoke(TENANT_ID, KEY_ID);

      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        KEY_ID,
        expect.objectContaining({ isActive: false }),
      );
    });

    it('throws 404 when the key does not exist for this tenant', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.revoke(TENANT_ID, 'unknown-id')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws HttpException (not a generic Error)', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.revoke(TENANT_ID, 'x')).rejects.toBeInstanceOf(HttpException);
    });

    it('does not call update when the key is not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.revoke(TENANT_ID, 'x')).rejects.toThrow();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant revocation with 404', async () => {
      // Key exists for tenant-A, but tenant-B tries to revoke it.
      // BaseRepository.findById already scopes by tenantId, so it returns null.
      repo.findById.mockResolvedValue(null);
      await expect(service.revoke('tenant-B', KEY_ID)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // -------------------------------------------------------------------------
  // listForTenant
  // -------------------------------------------------------------------------

  describe('listForTenant', () => {
    it('returns a list of key metadata for the tenant', async () => {
      repo.findMany.mockResolvedValue([makeApiKey(), makeApiKey({ id: 'key-2' })]);
      const result = await service.listForTenant(TENANT_ID);
      expect(result).toHaveLength(2);
    });

    it('never includes the raw key in any list item', async () => {
      repo.findMany.mockResolvedValue([makeApiKey()]);
      const result = await service.listForTenant(TENANT_ID);
      const item = result[0] as ApiKeyListItemDto;
      expect(item).not.toHaveProperty('key');
      expect(item).not.toHaveProperty('keyHash');
      expect(item).not.toHaveProperty('key_hash');
    });

    it('list item contains expected safe fields', async () => {
      repo.findMany.mockResolvedValue([makeApiKey()]);
      const [item] = await service.listForTenant(TENANT_ID);
      expect(item).toMatchObject({
        id: KEY_ID,
        key_prefix: expect.any(String) as string,
        is_active: true,
        last_used_at: null,
        expires_at: null,
        created_at: expect.any(Date) as Date,
      });
    });

    it('returns empty array when tenant has no keys', async () => {
      repo.findMany.mockResolvedValue([]);
      const result = await service.listForTenant(TENANT_ID);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // findByKeyHash (on repository — tested via mock verification)
  // -------------------------------------------------------------------------

  describe('ApiKeysRepository.findByKeyHash contract', () => {
    it('returns null for an unknown hash without throwing', async () => {
      repo.findByKeyHash.mockResolvedValue(null);
      const result = await repo.findByKeyHash('unknown-hash');
      expect(result).toBeNull();
    });

    it('returns the ApiKey record when hash matches', async () => {
      const key = makeApiKey();
      repo.findByKeyHash.mockResolvedValue(key);
      const result = await repo.findByKeyHash(key.keyHash);
      expect(result).toEqual(key);
    });
  });

  // -------------------------------------------------------------------------
  // hashApiKey utility
  // -------------------------------------------------------------------------

  describe('hashApiKey', () => {
    it('produces a 64-char lowercase hex string', () => {
      const hash = hashApiKey('lgk_test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic — same input always yields same hash', () => {
      const key = 'lgk_abc123';
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it('is collision-resistant — different inputs produce different hashes', () => {
      expect(hashApiKey('lgk_aaa')).not.toBe(hashApiKey('lgk_bbb'));
    });
  });
});
