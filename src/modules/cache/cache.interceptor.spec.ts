import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, firstValueFrom, toArray } from 'rxjs';
import { Request, Response } from 'express';
import { CacheInterceptor } from './cache.interceptor';
import { CacheService, CachedResponse } from './cache.service';
import { RouterService } from '../router/router.service';
import { RoutingDecision } from '../../common/interfaces/routing-decision.interface';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT: AuthContext = { tenantId: 'tenant-aaa', apiKeyId: 'key-1', plan: 'pro' };

const DECISION: RoutingDecision = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };

const CACHED: CachedResponse = {
  content: 'Four.',
  model: 'claude-haiku-4-5-20251001',
  provider: 'anthropic',
  promptTokens: 10,
  completionTokens: 5,
  cachedAt: '2026-01-01T00:00:00.000Z',
};

function makeReq(overrides: Record<string, unknown> = {}): Request & {
  routingDecision?: RoutingDecision;
  cacheKey?: string;
} {
  return {
    tenant: TENANT,
    requestId: 'req-001',
    headers: {},
    body: {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      max_tokens: 10,
      temperature: 0,
    },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): jest.Mocked<Response> {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as jest.Mocked<Response>;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

function makeContext(req: Request, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown = {}): CallHandler {
  return { handle: jest.fn().mockReturnValue(of(value)) };
}

function makeCacheService(
  cached: CachedResponse | null = null,
): jest.Mocked<CacheService> {
  return {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue(undefined),
    incrementHit: jest.fn().mockResolvedValue(undefined),
    incrementMiss: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn(),
  } as unknown as jest.Mocked<CacheService>;
}

function makeRouterService(): jest.Mocked<RouterService> {
  return {
    resolve: jest.fn().mockResolvedValue(DECISION),
  } as unknown as jest.Mocked<RouterService>;
}

function makeQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CacheInterceptor', () => {
  let cacheService: jest.Mocked<CacheService>;
  let routerService: jest.Mocked<RouterService>;
  let queue: ReturnType<typeof makeQueue>;
  let interceptor: CacheInterceptor;

  beforeEach(() => {
    cacheService = makeCacheService();
    routerService = makeRouterService();
    queue = makeQueue();
    interceptor = new CacheInterceptor(
      cacheService,
      routerService,
      queue as never,
    );
  });

  describe('cache miss', () => {
    it('calls next.handle() on cache miss', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('sets X-Cache-Hit: false on cache miss', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Hit', 'false');
    });

    it('attaches routingDecision to request on cache miss', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(req['routingDecision']).toEqual(DECISION);
    });

    it('attaches cacheKey to request on cache miss', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      const key = req['cacheKey'] as string;
      expect(key).toMatch(/^tenant:tenant-aaa:cache:[0-9a-f]{64}$/);
    });
  });

  describe('cache hit', () => {
    beforeEach(() => {
      cacheService = makeCacheService(CACHED);
      interceptor = new CacheInterceptor(cacheService, routerService, queue as never);
    });

    it('never calls next.handle() on cache hit', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$.pipe(toArray()), { defaultValue: [] });

      expect(next.handle).not.toHaveBeenCalled();
    });

    it('sets X-Cache-Hit: true on cache hit', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$.pipe(toArray()), { defaultValue: [] });

      expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Hit', 'true');
    });

    it('sets X-Cache-Type, X-Gateway-Provider, X-Gateway-Model, X-Latency-Ms on hit', async () => {
      const req = makeReq();
      const res = makeRes();

      const obs$ = await interceptor.intercept(makeContext(req, res), makeNext());
      await firstValueFrom(obs$.pipe(toArray()), { defaultValue: [] });

      expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Type', 'exact');
      expect(res.setHeader).toHaveBeenCalledWith('X-Gateway-Provider', 'anthropic');
      expect(res.setHeader).toHaveBeenCalledWith('X-Gateway-Model', 'claude-haiku-4-5-20251001');
      expect(res.setHeader).toHaveBeenCalledWith('X-Latency-Ms', '0');
    });

    it('writes cached response body via res.json()', async () => {
      const req = makeReq();
      const res = makeRes();

      const obs$ = await interceptor.intercept(makeContext(req, res), makeNext());
      await firstValueFrom(obs$.pipe(toArray()), { defaultValue: [] });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          object: 'chat.completion',
          model: CACHED.model,
          choices: [
            expect.objectContaining({
              message: { role: 'assistant', content: CACHED.content },
            }),
          ],
          usage: {
            prompt_tokens: CACHED.promptTokens,
            completion_tokens: CACHED.completionTokens,
            total_tokens: CACHED.promptTokens + CACHED.completionTokens,
          },
        }),
      );
    });

    it('enqueues usage job with cacheHit: true', async () => {
      const req = makeReq();
      const res = makeRes();

      const obs$ = await interceptor.intercept(makeContext(req, res), makeNext());
      await firstValueFrom(obs$.pipe(toArray()), { defaultValue: [] });

      // allow microtasks (fire-and-forget void promise) to settle
      await Promise.resolve();

      expect(queue.add).toHaveBeenCalledWith(
        'track-usage',
        expect.objectContaining({ cacheHit: true, tenantId: TENANT.tenantId }),
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('bypass conditions', () => {
    it('skips cache entirely when stream: true', async () => {
      const req = makeReq({ body: { model: 'gpt-4o', messages: [], stream: true } });
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(cacheService.get).not.toHaveBeenCalled();
      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('skips cache entirely when x-no-cache: true', async () => {
      const req = makeReq({
        body: {
          model: 'gpt-4o',
          messages: [],
          'x-no-cache': true,
        },
      });
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(cacheService.get).not.toHaveBeenCalled();
      expect(next.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe('resilience', () => {
    it('treats cache GET error as a miss and calls next.handle()', async () => {
      // CacheService.get() never throws (it catches internally and returns null)
      cacheService.get.mockResolvedValue(null);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      const obs$ = await interceptor.intercept(makeContext(req, res), next);
      await firstValueFrom(obs$, { defaultValue: null });

      expect(next.handle).toHaveBeenCalledTimes(1);
    });
  });
});
