import { Redis } from 'ioredis';
import { ProviderConfig } from '@prisma/client';
import { ProviderStatusService } from './provider-status.service';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { AppConfigService } from '../../config/config.service';
import { encrypt } from '../../common/utils/encryption.util';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = Buffer.alloc(32);
const TENANT = 'tenant-1';

function makeConfig(provider: string): ProviderConfig {
  const { ciphertext, iv } = encrypt('sk-test', TEST_KEY);
  return {
    id: `cfg-${provider}`,
    tenantId: TENANT,
    provider,
    apiKeyEncrypted: ciphertext,
    apiKeyIv: iv,
    isActive: true,
    rateLimitRpm: 60,
    rateLimitTpm: 100_000,
    monthlySpendLimitUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProviderConfig;
}

function makeService(
  redisMock: Partial<Redis>,
  repoMock: Partial<ProviderConfigsRepository>,
  configMock: Partial<AppConfigService>,
): ProviderStatusService {
  return new ProviderStatusService(
    redisMock as Redis,
    repoMock as ProviderConfigsRepository,
    configMock as AppConfigService,
  );
}

function makeRedisMock(cached: string | null = null) {
  return {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue('OK'),
  };
}

function makeRepoMock(configs: ProviderConfig[] = []) {
  return { findActiveByTenant: jest.fn().mockResolvedValue(configs) };
}

function makeConfigMock() {
  return { getEncryptionKey: jest.fn().mockReturnValue(TEST_KEY) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderStatusService', () => {
  afterEach(() => jest.restoreAllMocks());

  // ── getStatus — cache behaviour ──────────────────────────────────────────

  describe('getStatus', () => {
    it('returns cached response without calling repo when cache hits', async () => {
      const cachedPayload = {
        providers: [{ provider: 'anthropic', status: 'active', latencyMs: 80 }],
        checkedAt: '2026-01-01T00:00:00.000Z',
      };
      const redis = makeRedisMock(JSON.stringify(cachedPayload));
      const repo = makeRepoMock();
      const svc = makeService(redis, repo, makeConfigMock());

      const result = await svc.getStatus(TENANT);

      expect(result.cached).toBe(true);
      expect(result.providers).toEqual(cachedPayload.providers);
      expect(result.checkedAt).toBe(cachedPayload.checkedAt);
      expect(repo.findActiveByTenant).not.toHaveBeenCalled();
    });

    it('uses correct Redis cache key', async () => {
      const redis = makeRedisMock();
      const svc = makeService(redis, makeRepoMock(), makeConfigMock());

      await svc.getStatus('tenant-xyz');

      expect(redis.get).toHaveBeenCalledWith(
        'tenant:tenant-xyz:providers:status',
      );
    });

    it('returns cached: false on cache miss', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      const result = await svc.getStatus(TENANT);
      expect(result.cached).toBe(false);
    });

    it('stores result in Redis with 30s TTL on cache miss', async () => {
      const redis = makeRedisMock();
      const svc = makeService(redis, makeRepoMock(), makeConfigMock());

      await svc.getStatus(TENANT);

      expect(redis.set).toHaveBeenCalledWith(
        `tenant:${TENANT}:providers:status`,
        expect.any(String),
        'EX',
        30,
      );
    });

    it('returns empty providers array when no active configs', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock([]),
        makeConfigMock(),
      );
      const result = await svc.getStatus(TENANT);
      expect(result.providers).toEqual([]);
    });

    it('runs all provider checks in parallel via Promise.allSettled', async () => {
      const configs = [makeConfig('anthropic'), makeConfig('openai')];
      const repo = makeRepoMock(configs);
      const svc = makeService(makeRedisMock(), repo, makeConfigMock());

      const checkSpy = jest.spyOn(svc, 'checkProvider').mockResolvedValue({
        provider: 'anthropic',
        status: 'active',
        latencyMs: 50,
      });

      await svc.getStatus(TENANT);

      expect(checkSpy).toHaveBeenCalledTimes(2);
    });

    it('uses configs[i].provider in allSettled rejection fallback', async () => {
      const repo = makeRepoMock([makeConfig('gemini')]);
      const svc = makeService(makeRedisMock(), repo, makeConfigMock());

      // Force checkProvider to reject (unexpected error bypasses inner try/catch)
      jest
        .spyOn(svc, 'checkProvider')
        .mockRejectedValue(new Error('unexpected decrypt failure'));

      const result = await svc.getStatus(TENANT);

      expect(result.providers[0].provider).toBe('gemini');
      expect(result.providers[0].status).toBe('down');
      expect(result.providers[0].error).toContain('unexpected decrypt failure');
    });
  });

  // ── checkProvider ────────────────────────────────────────────────────────

  describe('checkProvider', () => {
    it('returns active when probe resolves quickly', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      jest.spyOn(svc, 'probe').mockResolvedValue(undefined);

      const result = await svc.checkProvider(makeConfig('anthropic'), TEST_KEY);

      expect(result.status).toBe('active');
      expect(result.provider).toBe('anthropic');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded when latency >= 3000ms', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      jest.spyOn(svc, 'probe').mockResolvedValue(undefined);

      // Simulate 3500ms elapsed between start and end
      let call = 0;
      jest
        .spyOn(Date, 'now')
        .mockImplementation(() => (call++ === 0 ? 1_000 : 4_500));

      const result = await svc.checkProvider(makeConfig('openai'), TEST_KEY);

      expect(result.status).toBe('degraded');
      expect(result.latencyMs).toBe(3_500);
    });

    it('returns down with error message when probe throws', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      jest.spyOn(svc, 'probe').mockRejectedValue(new Error('Unauthorized'));

      const result = await svc.checkProvider(makeConfig('openai'), TEST_KEY);

      expect(result.status).toBe('down');
      expect(result.provider).toBe('openai');
      expect(result.error).toBe('Unauthorized');
    });

    it('returns down when probe times out after 5000ms', async () => {
      jest.useFakeTimers();

      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      // Probe that never resolves
      jest
        .spyOn(svc, 'probe')
        .mockImplementation(() => new Promise<void>(() => {}));

      const promise = svc.checkProvider(makeConfig('anthropic'), TEST_KEY);
      await jest.advanceTimersByTimeAsync(5_001);
      const result = await promise;

      expect(result.status).toBe('down');
      expect(result.error).toContain('Timed out after 5000ms');

      jest.useRealTimers();
    });

    it('does not time out before 5000ms', async () => {
      jest.useFakeTimers();

      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      let resolved = false;

      jest.spyOn(svc, 'probe').mockImplementation(async () => {
        await new Promise<void>((res) => setTimeout(res, 4_999));
        resolved = true;
      });

      const promise = svc.checkProvider(makeConfig('openai'), TEST_KEY);
      await jest.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(resolved).toBe(true);
      // status may be 'degraded' since fake timers advance Date.now() — that's fine;
      // the assertion here is that the probe resolved rather than timing out.
      expect(result.status).not.toBe('down');

      jest.clearAllTimers();
      jest.useRealTimers();
    });
  });

  // ── probe routing ─────────────────────────────────────────────────────────

  describe('probe', () => {
    it('routes openai to probeOpenAI', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      const spy = jest.spyOn(svc, 'probeOpenAI').mockResolvedValue(undefined);

      await svc.probe('openai', 'key');

      expect(spy).toHaveBeenCalledWith('key');
    });

    it('routes anthropic to probeAnthropic', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      const spy = jest
        .spyOn(svc, 'probeAnthropic')
        .mockResolvedValue(undefined);

      await svc.probe('anthropic', 'key');

      expect(spy).toHaveBeenCalledWith('key');
    });

    it('routes gemini to probeGemini', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );
      const spy = jest.spyOn(svc, 'probeGemini').mockResolvedValue(undefined);

      await svc.probe('gemini', 'key');

      expect(spy).toHaveBeenCalledWith('key');
    });

    it('throws for unknown provider', async () => {
      const svc = makeService(
        makeRedisMock(),
        makeRepoMock(),
        makeConfigMock(),
      );

      await expect(svc.probe('cohere', 'key')).rejects.toThrow(
        'No probe defined for provider: cohere',
      );
    });
  });

  // ── checkedAt ─────────────────────────────────────────────────────────────

  it('includes a valid ISO checkedAt timestamp', async () => {
    const svc = makeService(makeRedisMock(), makeRepoMock(), makeConfigMock());
    const result = await svc.getStatus(TENANT);
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });
});
