import { Queue } from 'bull';
import { GatewayService } from './gateway.service';
import { RouterService } from '../router/router.service';
import { AdapterRegistry } from '../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayError } from '../../common/dto/gateway-error.dto';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(tenantId = 'tenant-1'): AuthContext {
  return { tenantId, apiKeyId: 'key-1', plan: 'pro' };
}

function makeDto(overrides: Partial<ChatCompletionRequestDto> = {}): ChatCompletionRequestDto {
  return {
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

const mockResponse = {
  content: 'Hi there!',
  model: 'claude-haiku-4-5-20251001',
  provider: 'anthropic',
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  finishReason: 'stop' as const,
};

const mockDecision = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GatewayService', () => {
  let service: GatewayService;
  let mockRouterService: jest.Mocked<Pick<RouterService, 'resolve'>>;
  let mockRegistry: jest.Mocked<Pick<AdapterRegistry, 'get'>>;
  let mockConfigsRepo: jest.Mocked<Pick<ProviderConfigsRepository, 'getDecryptedApiKey'>>;
  let mockUsageQueue: jest.Mocked<Pick<Queue, 'add'>>;
  let mockAdapter: { complete: jest.Mock };

  beforeEach(() => {
    mockAdapter = { complete: jest.fn().mockResolvedValue(mockResponse) };

    mockRouterService = {
      resolve: jest.fn().mockResolvedValue(mockDecision),
    };

    mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter),
    };

    mockConfigsRepo = {
      getDecryptedApiKey: jest.fn().mockResolvedValue('sk-test-key'),
    };

    mockUsageQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    service = new GatewayService(
      mockRouterService as unknown as RouterService,
      mockRegistry as unknown as AdapterRegistry,
      mockConfigsRepo as unknown as ProviderConfigsRepository,
      mockUsageQueue as unknown as Queue,
    );
  });

  it('resolves provider, fetches key, calls adapter, returns result', async () => {
    const result = await service.complete(makeDto(), makeCtx());

    expect(mockRouterService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001', tenantId: 'tenant-1' }),
      'tenant-1',
    );
    expect(mockConfigsRepo.getDecryptedApiKey).toHaveBeenCalledWith('tenant-1', 'anthropic');
    expect(mockRegistry.get).toHaveBeenCalledWith('anthropic');
    expect(mockAdapter.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      'sk-test-key',
    );
    expect(result.response).toMatchObject({ content: 'Hi there!' });
    expect(result.decision).toMatchObject({ provider: 'anthropic' });
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('passes xProvider and xTag to routerService.resolve', async () => {
    await service.complete(makeDto(), makeCtx(), 'openai', 'production');

    expect(mockRouterService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ xProvider: 'openai', xTag: 'production' }),
      'tenant-1',
    );
  });

  it('enqueues a usage job fire-and-forget after success', async () => {
    await service.complete(makeDto(), makeCtx());
    // Flush microtask queue so the fire-and-forget .add() runs
    await new Promise(setImmediate);

    expect(mockUsageQueue.add).toHaveBeenCalledWith(
      'log-usage',
      expect.objectContaining({
        tenantId: 'tenant-1',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      }),
    );
  });

  it('propagates GatewayError thrown by adapter', async () => {
    const err: GatewayError = {
      code: 'rate_limit',
      message: 'Too many requests',
      provider: 'anthropic',
      retryable: true,
      statusCode: 429,
    };
    mockAdapter.complete.mockRejectedValue(err);

    await expect(service.complete(makeDto(), makeCtx())).rejects.toMatchObject({
      code: 'rate_limit',
      statusCode: 429,
    });
  });

  it('propagates ProviderNotFoundError thrown by registry', async () => {
    const { ProviderNotFoundError } = jest.requireActual(
      '../providers/registry/adapter.registry',
    ) as typeof import('../providers/registry/adapter.registry');
    mockRegistry.get.mockImplementation(() => {
      throw new ProviderNotFoundError('unknown-provider');
    });

    await expect(service.complete(makeDto(), makeCtx())).rejects.toThrow(
      "Provider 'unknown-provider' is not registered",
    );
  });

  it('enqueues usage job with ruleId when routing rule matched', async () => {
    const ruleId = 'rule-abc-123';
    mockRouterService.resolve.mockResolvedValue({ ...mockDecision, ruleId });

    await service.complete(makeDto(), makeCtx());
    await new Promise(setImmediate);

    expect(mockUsageQueue.add).toHaveBeenCalledWith(
      'log-usage',
      expect.objectContaining({ ruleId }),
    );
  });
});
