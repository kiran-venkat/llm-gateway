import { Job } from 'bull';
import { CacheJob, CacheJobData } from './cache.job';
import { CacheService, CachedResponse } from '../../cache/cache.service';
import { GatewayService } from '../../gateway/gateway.service';
import { RouterService } from '../../router/router.service';
import { AdapterRegistry } from '../../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../../providers/provider-configs.repository';
import { StreamService } from '../../stream/stream.service';
import { CostCalculatorService } from '../cost-calculator.service';
import { GatewayResponse } from '../../../common/dto/gateway-response.dto';
import { RoutingDecision } from '../../../common/interfaces/routing-decision.interface';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import {
  ChatCompletionRequestDto,
  MessageDto,
} from '../../gateway/dto/chat-completion-request.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CACHE_KEY = 'tenant:t1:cache:abc123def456';

function makeJobData(overrides: Partial<CacheJobData> = {}): CacheJobData {
  return {
    cacheKey: CACHE_KEY,
    tenantId: 'tenant-111',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    content: '2 + 2 = 4',
    promptTokens: 14,
    completionTokens: 10,
    ttlSeconds: 3600,
    ...overrides,
  };
}

function makeJob(data: CacheJobData): Job<CacheJobData> {
  return { data } as Job<CacheJobData>;
}

function makeCacheService(): jest.Mocked<CacheService> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CacheService>;
}

// ---------------------------------------------------------------------------
// CacheJob processor tests
// ---------------------------------------------------------------------------

describe('CacheJob', () => {
  let cacheService: jest.Mocked<CacheService>;
  let job: CacheJob;

  beforeEach(() => {
    cacheService = makeCacheService();
    job = new CacheJob(cacheService);
  });

  it('calls cacheService.set with the correct CachedResponse shape', async () => {
    const data = makeJobData();
    await job.handle(makeJob(data));

    expect(cacheService.set).toHaveBeenCalledWith(
      CACHE_KEY,
      expect.objectContaining<Partial<CachedResponse>>({
        content: data.content,
        model: data.model,
        provider: data.provider,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
      }),
      3600,
    );
  });

  it('sets the correct TTL (3600 seconds)', async () => {
    await job.handle(makeJob(makeJobData({ ttlSeconds: 3600 })));
    expect(cacheService.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      3600,
    );
  });

  it('sets cachedAt as an ISO timestamp', async () => {
    await job.handle(makeJob(makeJobData()));

    const [, cached] = cacheService.set.mock.calls[0];
    expect(() => new Date(cached.cachedAt)).not.toThrow();
    expect(new Date(cached.cachedAt).toISOString()).toBe(cached.cachedAt);
  });

  it('does not rethrow when cacheService.set throws', async () => {
    cacheService.set.mockRejectedValue(new Error('Redis unavailable'));
    await expect(job.handle(makeJob(makeJobData()))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GatewayService — cache queue enqueue behaviour
// ---------------------------------------------------------------------------

describe('GatewayService cache enqueue', () => {
  const TENANT: AuthContext = { tenantId: 't1', apiKeyId: 'k1', plan: 'pro' };
  const DECISION: RoutingDecision = {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
  };
  const RESPONSE: GatewayResponse = {
    content: '2 + 2 = 4',
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    promptTokens: 14,
    completionTokens: 10,
    totalTokens: 24,
    finishReason: 'stop',
  };

  function makeDto(): ChatCompletionRequestDto {
    const dto = new ChatCompletionRequestDto();
    dto.model = 'claude-haiku-4-5-20251001';
    const msg = new MessageDto();
    msg.role = 'user';
    msg.content = 'What is 2+2?';
    dto.messages = [msg];
    dto.max_tokens = 10;
    dto.temperature = 0;
    return dto;
  }

  function makeDeps() {
    const routerService = {
      resolve: jest.fn().mockResolvedValue(DECISION),
    } as unknown as jest.Mocked<RouterService>;

    const registry = {
      get: jest.fn().mockReturnValue({
        complete: jest.fn().mockResolvedValue(RESPONSE),
        completeStream: jest.fn(),
      }),
    } as unknown as jest.Mocked<AdapterRegistry>;

    const providerConfigsRepo = {
      getDecryptedApiKey: jest.fn().mockResolvedValue('sk-test'),
    } as unknown as jest.Mocked<ProviderConfigsRepository>;

    const streamService = {} as StreamService;

    const usageQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const cacheQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const costCalculator = {
      calculateCost: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CostCalculatorService>;

    const svc = new GatewayService(
      routerService,
      registry,
      providerConfigsRepo,
      streamService,
      usageQueue as never,
      cacheQueue as never,
      costCalculator,
    );

    return { svc, cacheQueue, usageQueue };
  }

  it('enqueues a cache-response job when cacheKey is present', async () => {
    const { svc, cacheQueue } = makeDeps();

    await svc.complete(
      makeDto(),
      TENANT,
      'req-1',
      undefined,
      undefined,
      DECISION,
      CACHE_KEY,
    );

    // allow microtask (fire-and-forget void) to settle
    await Promise.resolve();

    expect(cacheQueue.add).toHaveBeenCalledWith(
      'cache-response',
      expect.objectContaining({
        cacheKey: CACHE_KEY,
        tenantId: TENANT.tenantId,
        content: RESPONSE.content,
        ttlSeconds: 3600,
      }),
    );
  });

  it('does NOT enqueue a cache-response job when cacheKey is absent', async () => {
    const { svc, cacheQueue } = makeDeps();

    await svc.complete(
      makeDto(),
      TENANT,
      'req-1',
      undefined,
      undefined,
      DECISION,
    );

    await Promise.resolve();

    expect(cacheQueue.add).not.toHaveBeenCalled();
  });
});
