import { CacheService, CachedResponse } from './cache.service';

// ---------------------------------------------------------------------------
// Minimal ioredis mock
// ---------------------------------------------------------------------------

function makeRedis() {
  const store = new Map<string, string>();

  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const prev = parseInt(store.get(key) ?? '0', 10);
      store.set(key, String(prev + 1));
      return prev + 1;
    }),
    incrby: jest.fn(async (key: string, delta: number) => {
      const prev = parseInt(store.get(key) ?? '0', 10);
      store.set(key, String(prev + delta));
      return prev + delta;
    }),
    _store: store,
  };
}

const TENANT = 'tenant-t1';
const BASE = `tenant:${TENANT}:cache:stats`;

const RESPONSE: CachedResponse = {
  content: 'hello',
  model: 'gpt-4o',
  provider: 'openai',
  promptTokens: 20,
  completionTokens: 10,
  cachedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// get / set
// ---------------------------------------------------------------------------

describe('CacheService — get/set', () => {
  let redis: ReturnType<typeof makeRedis>;
  let svc: CacheService;

  beforeEach(() => {
    redis = makeRedis();
    svc = new CacheService(redis as never);
  });

  it('returns null on cache miss', async () => {
    expect(await svc.get('missing-key')).toBeNull();
  });

  it('returns parsed value after set', async () => {
    await svc.set('k1', RESPONSE, 60);
    const result = await svc.get('k1');
    expect(result).toEqual(RESPONSE);
  });

  it('returns null and does not throw when redis.get throws', async () => {
    redis.get.mockRejectedValueOnce(new Error('connection lost'));
    await expect(svc.get('k1')).resolves.toBeNull();
  });

  it('does not throw when redis.set throws', async () => {
    redis.set.mockRejectedValueOnce(new Error('write failed'));
    await expect(svc.set('k1', RESPONSE, 60)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// incrementHit / incrementMiss
// ---------------------------------------------------------------------------

describe('CacheService — stats increments', () => {
  let redis: ReturnType<typeof makeRedis>;
  let svc: CacheService;

  beforeEach(() => {
    redis = makeRedis();
    svc = new CacheService(redis as never);
  });

  it('increments hits counter', async () => {
    await svc.incrementHit(TENANT, 30);
    expect(redis.incr).toHaveBeenCalledWith(`${BASE}:hits`);
  });

  it('increments tokens_saved by the supplied amount', async () => {
    await svc.incrementHit(TENANT, 30);
    expect(redis.incrby).toHaveBeenCalledWith(`${BASE}:tokens_saved`, 30);
  });

  it('increments misses counter', async () => {
    await svc.incrementMiss(TENANT);
    expect(redis.incr).toHaveBeenCalledWith(`tenant:${TENANT}:cache:stats:misses`);
  });

  it('does not throw when redis throws during incrementHit', async () => {
    redis.incr.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.incrementHit(TENANT, 10)).resolves.toBeUndefined();
  });

  it('does not throw when redis throws during incrementMiss', async () => {
    redis.incr.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.incrementMiss(TENANT)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe('CacheService — getStats', () => {
  let redis: ReturnType<typeof makeRedis>;
  let svc: CacheService;

  beforeEach(() => {
    redis = makeRedis();
    svc = new CacheService(redis as never);
  });

  it('returns all zeros when no data exists', async () => {
    const stats = await svc.getStats(TENANT);
    expect(stats).toEqual({
      hits: 0,
      misses: 0,
      total: 0,
      hitRatePct: 0,
      tokensSaved: 0,
      estimatedCostSavedUsd: 0,
    });
  });

  it('calculates hitRatePct correctly', async () => {
    redis._store.set(`${BASE}:hits`, '3');
    redis._store.set(`${BASE}:misses`, '7');
    const stats = await svc.getStats(TENANT);
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(7);
    expect(stats.total).toBe(10);
    expect(stats.hitRatePct).toBe(30);
  });

  it('computes estimatedCostSavedUsd from tokensSaved', async () => {
    redis._store.set(`${BASE}:tokens_saved`, '1000');
    const stats = await svc.getStats(TENANT);
    // $0.002 per 1K tokens → 1000 tokens = $0.002
    expect(stats.estimatedCostSavedUsd).toBe(0.002);
  });

  it('returns zero-filled stats and does not throw when redis fails', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));
    const stats = await svc.getStats(TENANT);
    expect(stats).toEqual({
      hits: 0,
      misses: 0,
      total: 0,
      hitRatePct: 0,
      tokensSaved: 0,
      estimatedCostSavedUsd: 0,
    });
  });
});
