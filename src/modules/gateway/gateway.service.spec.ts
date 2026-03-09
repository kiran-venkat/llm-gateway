import { Queue } from 'bull';
import { Response } from 'express';
import { GatewayService } from './gateway.service';
import { RouterService } from '../router/router.service';
import { AdapterRegistry } from '../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
import { StreamService } from '../stream/stream.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayError } from '../../common/dto/gateway-error.dto';
import { StreamChunk } from '../../common/dto/stream-chunk.dto';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQ_ID = 'test-request-id-1234';

function makeCtx(tenantId = 'tenant-1'): AuthContext {
  return { tenantId, apiKeyId: 'key-1', plan: 'pro' };
}

function makeDto(
  overrides: Partial<ChatCompletionRequestDto> = {},
): ChatCompletionRequestDto {
  return {
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function makeMockRes(): jest.Mocked<
  Pick<Response, 'setHeader' | 'flushHeaders' | 'write' | 'end'>
> {
  return {
    setHeader: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

async function* makeStreamChunks(texts: string[]): AsyncIterable<StreamChunk> {
  for (let i = 0; i < texts.length; i++) {
    yield { content: texts[i], index: i, done: false };
  }
}

const mockProviderResponse = {
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
  let mockConfigsRepo: jest.Mocked<
    Pick<ProviderConfigsRepository, 'getDecryptedApiKey'>
  >;
  let mockStreamService: jest.Mocked<Pick<StreamService, 'proxy'>>;
  let mockUsageQueue: jest.Mocked<Pick<Queue, 'add'>>;
  let mockAdapter: { complete: jest.Mock; completeStream: jest.Mock };

  beforeEach(() => {
    mockAdapter = {
      complete: jest.fn().mockResolvedValue(mockProviderResponse),
      completeStream: jest
        .fn()
        .mockReturnValue(makeStreamChunks(['Hello', ' world'])),
    };

    mockRouterService = { resolve: jest.fn().mockResolvedValue(mockDecision) };
    mockRegistry = { get: jest.fn().mockReturnValue(mockAdapter) };
    mockConfigsRepo = {
      getDecryptedApiKey: jest.fn().mockResolvedValue('sk-test-key'),
    };
    mockUsageQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    mockStreamService = {
      proxy: jest.fn().mockImplementation(async (opts) => {
        opts.onComplete({
          content: 'Hello world',
          chunkCount: 2,
          firstChunkMs: 50,
          totalMs: 300,
        });
      }),
    };

    service = new GatewayService(
      mockRouterService as unknown as RouterService,
      mockRegistry as unknown as AdapterRegistry,
      mockConfigsRepo as unknown as ProviderConfigsRepository,
      mockStreamService as unknown as StreamService,
      mockUsageQueue as unknown as Queue,
    );
  });

  // ── Non-streaming ────────────────────────────────────────────────────────

  it('resolves provider, fetches key, calls adapter, returns result', async () => {
    const result = await service.complete(makeDto(), makeCtx(), REQ_ID);

    expect(mockRouterService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        tenantId: 'tenant-1',
      }),
      'tenant-1',
    );
    expect(mockConfigsRepo.getDecryptedApiKey).toHaveBeenCalledWith(
      'tenant-1',
      'anthropic',
    );
    expect(mockRegistry.get).toHaveBeenCalledWith('anthropic');
    expect(mockAdapter.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        stream: false,
      }),
      'sk-test-key',
    );
    expect(result.response).toMatchObject({ content: 'Hi there!' });
    expect(result.decision).toMatchObject({ provider: 'anthropic' });
    expect(result.requestId).toBe(REQ_ID);
  });

  it('passes xProvider and xTag to routerService.resolve', async () => {
    await service.complete(
      makeDto(),
      makeCtx(),
      REQ_ID,
      'openai',
      'production',
    );

    expect(mockRouterService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ xProvider: 'openai', xTag: 'production' }),
      'tenant-1',
    );
  });

  it('enqueues a usage job fire-and-forget after success', async () => {
    await service.complete(makeDto(), makeCtx(), REQ_ID);
    await new Promise(setImmediate);

    expect(mockUsageQueue.add).toHaveBeenCalledWith(
      'log-usage',
      expect.objectContaining({
        requestId: REQ_ID,
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

    await expect(
      service.complete(makeDto(), makeCtx(), REQ_ID),
    ).rejects.toMatchObject({ code: 'rate_limit', statusCode: 429 });
  });

  it('propagates ProviderNotFoundError thrown by registry', async () => {
    const { ProviderNotFoundError } = jest.requireActual(
      '../providers/registry/adapter.registry',
    ) as typeof import('../providers/registry/adapter.registry');
    mockRegistry.get.mockImplementation(() => {
      throw new ProviderNotFoundError('unknown-provider');
    });

    await expect(
      service.complete(makeDto(), makeCtx(), REQ_ID),
    ).rejects.toThrow("Provider 'unknown-provider' is not registered");
  });

  it('enqueues usage job with ruleId when routing rule matched', async () => {
    const ruleId = 'rule-abc-123';
    mockRouterService.resolve.mockResolvedValue({ ...mockDecision, ruleId });

    await service.complete(makeDto(), makeCtx(), REQ_ID);
    await new Promise(setImmediate);

    expect(mockUsageQueue.add).toHaveBeenCalledWith(
      'log-usage',
      expect.objectContaining({ ruleId }),
    );
  });

  // ── Streaming ────────────────────────────────────────────────────────────

  it('completeStream() calls adapter.completeStream() not complete()', async () => {
    const res = makeMockRes();

    await service.completeStream(
      makeDto({ stream: true }),
      makeCtx(),
      res as unknown as Response,
      REQ_ID,
    );

    expect(mockAdapter.completeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        stream: true,
      }),
      'sk-test-key',
    );
    expect(mockAdapter.complete).not.toHaveBeenCalled();
  });

  it('completeStream() passes requestId to streamService.proxy()', async () => {
    const res = makeMockRes();

    await service.completeStream(
      makeDto({ stream: true }),
      makeCtx(),
      res as unknown as Response,
      REQ_ID,
    );

    expect(mockStreamService.proxy).toHaveBeenCalledWith(
      expect.objectContaining({ response: res, requestId: REQ_ID }),
    );
  });

  it('completeStream() sets X-Gateway-Provider and X-Gateway-Model before proxy()', async () => {
    const res = makeMockRes();
    const headersSetBeforeProxy: string[] = [];

    mockStreamService.proxy.mockImplementation(async () => {
      (res.setHeader as jest.Mock).mock.calls.forEach(([name]: [string]) => {
        headersSetBeforeProxy.push(name);
      });
    });

    await service.completeStream(
      makeDto({ stream: true }),
      makeCtx(),
      res as unknown as Response,
      REQ_ID,
    );

    expect(headersSetBeforeProxy).toContain('X-Gateway-Provider');
    expect(headersSetBeforeProxy).toContain('X-Gateway-Model');
  });

  it('onComplete callback enqueues UsageJob with stream: true', async () => {
    const res = makeMockRes();

    await service.completeStream(
      makeDto({ stream: true }),
      makeCtx(),
      res as unknown as Response,
      REQ_ID,
    );
    await new Promise(setImmediate);

    expect(mockUsageQueue.add).toHaveBeenCalledWith(
      'log-usage',
      expect.objectContaining({
        requestId: REQ_ID,
        stream: true,
        tenantId: 'tenant-1',
        provider: 'anthropic',
      }),
    );
  });
});
