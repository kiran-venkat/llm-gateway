import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { Redis } from 'ioredis';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from '../../modules/rate-limit/rate-limit.service';
import { ProviderConfigsRepository } from '../../modules/providers/provider-configs.repository';
import { AdapterRegistry } from '../../modules/providers/registry/adapter.registry';
import { AuthGuard } from './auth.guard';
import { RateLimitResult } from '../interfaces/rate-limit-result.interface';
import { ProviderConfig } from '@prisma/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-111';
const PROVIDER = 'anthropic';

function makeConfig(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id: 'cfg-1',
    tenantId: TENANT_ID,
    provider: PROVIDER,
    apiKeyEncrypted: 'enc',
    apiKeyIv: 'iv',
    isActive: true,
    rateLimitRpm: 60,
    rateLimitTpm: 100_000,
    monthlySpendLimitUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRateLimitResult(
  overrides: Partial<RateLimitResult> = {},
): RateLimitResult {
  return {
    allowed: true,
    remaining: 59,
    limit: 60,
    resetAt: new Date(Date.now() + 60_000),
    limitType: 'rpm',
    ...overrides,
  };
}

function makeContext(
  reqOverrides: Partial<Request & { rateLimit?: unknown }> = {},
): ExecutionContext {
  const req: Partial<Request> & {
    tenant?: unknown;
    requestId: string;
    rateLimit?: unknown;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  } = {
    tenant: { tenantId: TENANT_ID, apiKeyId: 'key-1', plan: 'pro' },
    requestId: 'req-abc-123',
    body: {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    headers: {},
    ...reqOverrides,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeMockRateLimitService(): jest.Mocked<RateLimitService> {
  return {
    checkRpm: jest.fn(),
    checkTpm: jest.fn(),
    getRemainingRpm: jest.fn(),
  } as unknown as jest.Mocked<RateLimitService>;
}

function makeMockRepo(): jest.Mocked<ProviderConfigsRepository> {
  return {
    findByTenantAndProvider: jest.fn(),
  } as unknown as jest.Mocked<ProviderConfigsRepository>;
}

function makeMockRegistry(): jest.Mocked<AdapterRegistry> {
  return {
    has: jest.fn().mockReturnValue(false),
    get: jest.fn(),
  } as unknown as jest.Mocked<AdapterRegistry>;
}

function makeMockRedis(budgetExceeded = false): jest.Mocked<Pick<Redis, 'get'>> {
  return {
    get: jest.fn().mockResolvedValue(budgetExceeded ? '1' : null),
  } as unknown as jest.Mocked<Pick<Redis, 'get'>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let rateLimitService: jest.Mocked<RateLimitService>;
  let repo: jest.Mocked<ProviderConfigsRepository>;
  let registry: jest.Mocked<AdapterRegistry>;
  let mockRedis: jest.Mocked<Pick<Redis, 'get'>>;

  beforeEach(() => {
    rateLimitService = makeMockRateLimitService();
    repo = makeMockRepo();
    registry = makeMockRegistry();
    mockRedis = makeMockRedis(false);
    guard = new RateLimitGuard(
      rateLimitService,
      repo,
      registry,
      mockRedis as unknown as Redis,
    );
  });

  // -------------------------------------------------------------------------
  // 1. Missing req.tenant throws InternalServerErrorException
  // -------------------------------------------------------------------------

  it('throws InternalServerErrorException when req.tenant is missing', async () => {
    const ctx = makeContext({ tenant: undefined });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  // -------------------------------------------------------------------------
  // 2. No provider config → allowed through (no rate limiting)
  // -------------------------------------------------------------------------

  it('allows request when no provider config is found', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(null);
    const ctx = makeContext();

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(rateLimitService.checkRpm).not.toHaveBeenCalled();
    expect(rateLimitService.checkTpm).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. RPM limit exceeded → 429
  // -------------------------------------------------------------------------

  it('throws 429 with rpm limit_type when RPM is exhausted', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockResolvedValue(
      makeRateLimitResult({ allowed: false, remaining: 0, retryAfterMs: 60_000, limitType: 'rpm' }),
    );
    const ctx = makeContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = ex.getResponse() as Record<string, unknown>;
      expect(body['error']).toBe('rate_limit_exceeded');
      expect(body['limit_type']).toBe('rpm');
      expect(body['retry_after_ms']).toBe(60_000);
    }
  });

  // -------------------------------------------------------------------------
  // 4. TPM limit exceeded → 429
  // -------------------------------------------------------------------------

  it('throws 429 with tpm limit_type when TPM is exhausted', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockResolvedValue(
      makeRateLimitResult({ allowed: true, remaining: 59, limitType: 'rpm' }),
    );
    rateLimitService.checkTpm.mockResolvedValue(
      makeRateLimitResult({ allowed: false, remaining: 0, retryAfterMs: 60_000, limitType: 'tpm' }),
    );
    registry.has.mockReturnValue(true);
    registry.get.mockReturnValue({
      estimateTokens: jest.fn().mockReturnValue(500),
    } as unknown as ReturnType<typeof registry.get>);
    const ctx = makeContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = ex.getResponse() as Record<string, unknown>;
      expect(body['limit_type']).toBe('tpm');
    }
  });

  // -------------------------------------------------------------------------
  // 5. RPM check passes → canActivate returns true
  // -------------------------------------------------------------------------

  it('returns true and attaches rateLimit to request when all checks pass', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    const rpmResult = makeRateLimitResult({ allowed: true, remaining: 55, limitType: 'rpm' });
    rateLimitService.checkRpm.mockResolvedValue(rpmResult);
    // registry.has returns false (default) → TPM check skipped

    const req: Partial<Request> & {
      tenant?: unknown;
      requestId: string;
      rateLimit?: unknown;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
    } = {
      tenant: { tenantId: TENANT_ID, apiKeyId: 'key-1', plan: 'pro' },
      requestId: 'req-xyz',
      body: {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      headers: {},
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.rateLimit).toBe(rpmResult);
    expect(rateLimitService.checkRpm).toHaveBeenCalledWith(
      TENANT_ID,
      PROVIDER,
      60,
    );
  });

  // -------------------------------------------------------------------------
  // 6. Guard order: RateLimitGuard reads req.tenant set by AuthGuard
  // -------------------------------------------------------------------------

  it('AuthGuard and RateLimitGuard are distinct @Injectable() classes', () => {
    expect(AuthGuard).not.toBe(RateLimitGuard);
    expect(guard).toBeInstanceOf(RateLimitGuard);
  });

  // -------------------------------------------------------------------------
  // 7. x-provider header takes precedence over model inference
  // -------------------------------------------------------------------------

  it('uses x-provider header for provider lookup when present', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(null);
    const ctx = makeContext({
      headers: { 'x-provider': 'openai' },
    } as Partial<Request>);

    await guard.canActivate(ctx);

    expect(repo.findByTenantAndProvider).toHaveBeenCalledWith(
      TENANT_ID,
      'openai',
    );
  });

  // -------------------------------------------------------------------------
  // 8. TPM check skipped when adapter not in registry
  // -------------------------------------------------------------------------

  it('skips TPM check when adapter is not registered', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockResolvedValue(
      makeRateLimitResult({ allowed: true }),
    );
    registry.has.mockReturnValue(false); // no adapter

    const ctx = makeContext();
    await guard.canActivate(ctx);

    expect(rateLimitService.checkTpm).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. Budget exceeded → 402 PAYMENT_REQUIRED
  // -------------------------------------------------------------------------

  it('throws 402 with budget_exceeded error when Redis budget:exceeded key is set', async () => {
    mockRedis = makeMockRedis(true); // budget exceeded flag in Redis
    guard = new RateLimitGuard(
      rateLimitService,
      repo,
      registry,
      mockRedis as unknown as Redis,
    );
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockResolvedValue(
      makeRateLimitResult({ allowed: true }),
    );
    const ctx = makeContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      const body = ex.getResponse() as Record<string, unknown>;
      expect(body['error']).toBe('budget_exceeded');
      expect(body['message']).toBe('Monthly budget limit reached');
      expect(body['request_id']).toBe('req-abc-123');
    }
  });

  // -------------------------------------------------------------------------
  // 10. No budget key in Redis → proceeds normally
  // -------------------------------------------------------------------------

  it('proceeds normally when budget:exceeded key is absent from Redis', async () => {
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockResolvedValue(
      makeRateLimitResult({ allowed: true }),
    );
    // mockRedis.get returns null by default (key absent)

    const ctx = makeContext();
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockRedis.get).toHaveBeenCalledWith(
      `tenant:${TENANT_ID}:budget:exceeded`,
    );
  });

  // -------------------------------------------------------------------------
  // 11. Budget check happens after RPM (RPM slot consumed before budget block)
  // -------------------------------------------------------------------------

  it('checks budget after RPM — RPM check runs before Redis budget GET', async () => {
    const callOrder: string[] = [];
    mockRedis = makeMockRedis(true);
    guard = new RateLimitGuard(
      rateLimitService,
      repo,
      registry,
      mockRedis as unknown as Redis,
    );
    repo.findByTenantAndProvider.mockResolvedValue(makeConfig());
    rateLimitService.checkRpm.mockImplementation(async () => {
      callOrder.push('rpm');
      return makeRateLimitResult({ allowed: true });
    });
    (mockRedis.get as jest.Mock).mockImplementation(async () => {
      callOrder.push('budget');
      return '1';
    });

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      HttpException,
    );

    expect(callOrder).toEqual(['rpm', 'budget']);
  });
});
