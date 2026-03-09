import { HttpException } from '@nestjs/common';
import { ProviderConfig } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { encrypt } from '../../common/utils/encryption.util';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { ProviderConfigsService } from './provider-configs.service';

// ---------------------------------------------------------------------------
// Shared test key — matches dev ENCRYPTION_KEY (64 zeros → 32 zero bytes)
// ---------------------------------------------------------------------------
const TEST_KEY = Buffer.alloc(32);

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const { ciphertext, iv } = encrypt('sk-real-key', TEST_KEY);
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    provider: 'openai',
    apiKeyEncrypted: ciphertext,
    apiKeyIv: iv,
    isActive: true,
    rateLimitRpm: 60,
    rateLimitTpm: 100000,
    monthlySpendLimitUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProviderConfig;
}

// ---------------------------------------------------------------------------
// Service unit tests (mocked repo)
// ---------------------------------------------------------------------------

describe('ProviderConfigsService', () => {
  let service: ProviderConfigsService;
  let mockRepo: jest.Mocked<
    Pick<
      ProviderConfigsRepository,
      | 'findByTenantAndProvider'
      | 'findActiveByTenant'
      | 'create'
      | 'update'
    >
  >;

  beforeEach(() => {
    mockRepo = {
      findByTenantAndProvider: jest.fn(),
      findActiveByTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    const mockConfig = {
      getEncryptionKey: () => TEST_KEY,
    } as unknown as AppConfigService;

    service = new ProviderConfigsService(
      mockRepo as unknown as ProviderConfigsRepository,
      mockConfig,
    );
  });

  // ── upsert() ──────────────────────────────────────────────────────────────

  describe('upsert()', () => {
    it('stores encrypted key — never persists the plaintext api_key', async () => {
      mockRepo.findByTenantAndProvider.mockResolvedValue(null);

      let capturedData: Record<string, unknown> | undefined;
      mockRepo.create.mockImplementation(async (_tenantId, data) => {
        capturedData = data;
        return makeConfig({ provider: 'openai' });
      });

      await service.upsert('tenant-1', {
        provider: 'openai',
        api_key: 'sk-this-is-the-real-key',
      });

      expect(capturedData?.apiKeyEncrypted).toBeDefined();
      expect(capturedData?.apiKeyEncrypted).not.toBe('sk-this-is-the-real-key');
      expect(capturedData?.apiKeyIv).toBeDefined();
      // Verify ciphertext is hex
      expect(capturedData?.apiKeyEncrypted).toMatch(/^[0-9a-f]+$/);
    });

    it('calls update() when config already exists for tenant + provider', async () => {
      const existing = makeConfig();
      mockRepo.findByTenantAndProvider.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(existing);

      await service.upsert('tenant-1', {
        provider: 'openai',
        api_key: 'sk-new-key-here',
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'tenant-1',
        existing.id,
        expect.objectContaining({ apiKeyEncrypted: expect.any(String) }),
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('calls create() when no config exists', async () => {
      mockRepo.findByTenantAndProvider.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeConfig());

      await service.upsert('tenant-1', {
        provider: 'openai',
        api_key: 'sk-brand-new-key',
      });

      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('passes optional rate limits to the repo', async () => {
      mockRepo.findByTenantAndProvider.mockResolvedValue(null);
      let capturedData: Record<string, unknown> | undefined;
      mockRepo.create.mockImplementation(async (_tid, data) => {
        capturedData = data;
        return makeConfig();
      });

      await service.upsert('tenant-1', {
        provider: 'openai',
        api_key: 'sk-key-here-long',
        rate_limit_rpm: 120,
        rate_limit_tpm: 50000,
      });

      expect(capturedData?.rateLimitRpm).toBe(120);
      expect(capturedData?.rateLimitTpm).toBe(50000);
    });
  });

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it("returns masked api_key '****' — never the real ciphertext", async () => {
      mockRepo.findActiveByTenant.mockResolvedValue([makeConfig()]);

      const result = await service.list('tenant-1');

      expect(result).toHaveLength(1);
      expect(result[0].api_key).toBe('****');
    });

    it('returns correct provider and rate limits', async () => {
      mockRepo.findActiveByTenant.mockResolvedValue([
        makeConfig({ provider: 'anthropic', rateLimitRpm: 30, rateLimitTpm: 200000 }),
      ]);

      const [item] = await service.list('tenant-1');

      expect(item.provider).toBe('anthropic');
      expect(item.rate_limit_rpm).toBe(30);
      expect(item.rate_limit_tpm).toBe(200000);
    });
  });

  // ── remove() ──────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('sets is_active = false — soft delete, not hard delete', async () => {
      const existing = makeConfig();
      mockRepo.findByTenantAndProvider.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue({ ...existing, isActive: false } as ProviderConfig);

      await service.remove('tenant-1', 'openai');

      expect(mockRepo.update).toHaveBeenCalledWith('tenant-1', existing.id, {
        isActive: false,
      });
    });

    it('throws 404 when config does not exist', async () => {
      mockRepo.findByTenantAndProvider.mockResolvedValue(null);

      await expect(service.remove('tenant-1', 'gemini')).rejects.toThrow(
        HttpException,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Repository test — getDecryptedApiKey round-trip
// ---------------------------------------------------------------------------

describe('ProviderConfigsRepository.getDecryptedApiKey()', () => {
  it('returns the original plaintext API key after encrypt → store → decrypt', async () => {
    const ORIGINAL_KEY = 'sk-ant-api03-supersecretkey';
    const { ciphertext, iv } = encrypt(ORIGINAL_KEY, TEST_KEY);

    // In-memory delegate with one stored config
    const store: ProviderConfig[] = [
      makeConfig({
        tenantId: 'tenant-repo',
        provider: 'anthropic',
        apiKeyEncrypted: ciphertext,
        apiKeyIv: iv,
      }),
    ];

    const mockDelegate = {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.find((r) =>
          Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        ) ?? null,
      findMany: async () => [],
      create: async () => store[0],
      update: async () => store[0],
      delete: async () => undefined,
    };

    // Build repository wired to the mock delegate and config
    const { ProviderConfigsRepository: Repo } = await import(
      './provider-configs.repository'
    );

    const mockPrisma = {
      providerConfig: mockDelegate,
    };
    const mockConfig = {
      getEncryptionKey: () => TEST_KEY,
    } as unknown as AppConfigService;

    const repo = new Repo(mockPrisma as never, mockConfig);

    const result = await repo.getDecryptedApiKey('tenant-repo', 'anthropic');
    expect(result).toBe(ORIGINAL_KEY);
  });
});
