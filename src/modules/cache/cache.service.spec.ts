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

function makePrisma(entries: { requestHash: string; hitCount: number; costSavedUsd: number }[] = []) {
  return {
    cacheEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
    },
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
    svc = new CacheService(redis as never, makePrisma() as never);
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
    svc = new CacheService(redis as never, makePrisma() as never);
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
  let prisma: ReturnType<typeof makePrisma>;
  let svc: CacheService;

  beforeEach(() => {
    redis = makeRedis();
    prisma = makePrisma();
    svc = new CacheService(redis as never, prisma as never);
  });

  it('returns all zeros and empty top_entries when no data exists', async () => {
    const stats = await svc.getStats(TENANT);
    expect(stats).toEqual({
      total_hits: 0,
      hit_rate: 0,
      cost_saved_usd: 0,
      top_entries: [],
    });
  });

  it('calculates hit_rate as 0-1 fraction', async () => {
    redis._store.set(`${BASE}:hits`, '3');
    redis._store.set(`${BASE}:misses`, '7');
    const stats = await svc.getStats(TENANT);
    expect(stats.total_hits).toBe(3);
    expect(stats.hit_rate).toBeCloseTo(0.3, 10);
  });

  it('hit_rate is 0 when total is 0 (no division by zero)', async () => {
    const stats = await svc.getStats(TENANT);
    expect(stats.hit_rate).toBe(0);
  });

  it('computes cost_saved_usd without rounding small values to zero', async () => {
    redis._store.set(`${BASE}:tokens_saved`, '24');
    const stats = await svc.getStats(TENANT);
    // 24 tokens × $0.002/1K = $0.000048
    expect(stats.cost_saved_usd).toBeCloseTo(0.000048, 8);
  });

  it('computes cost_saved_usd for 1000 tokens correctly', async () => {
    redis._store.set(`${BASE}:tokens_saved`, '1000');
    const stats = await svc.getStats(TENANT);
    expect(stats.cost_saved_usd).toBeCloseTo(0.002, 8);
  });

  it('returns top_entries mapped from prisma with hash truncated to 16 chars', async () => {
    prisma.cacheEntry.findMany.mockResolvedValue([
      { requestHash: 'abcdef1234567890abcdef1234567890', hitCount: 5, costSavedUsd: 0.00024 },
      { requestHash: 'deadbeefdeadbeefdeadbeefdeadbeef', hitCount: 2, costSavedUsd: 0.000096 },
    ]);
    const stats = await svc.getStats(TENANT);
    expect(stats.top_entries).toEqual([
      { hash: 'abcdef1234567890', hit_count: 5, cost_saved: 0.00024 },
      { hash: 'deadbeefdeadbeef', hit_count: 2, cost_saved: 0.000096 },
    ]);
  });

  it('queries prisma with correct tenant, ordering and limit', async () => {
    await svc.getStats(TENANT);
    expect(prisma.cacheEntry.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      orderBy: { hitCount: 'desc' },
      take: 10,
      select: { requestHash: true, hitCount: true, costSavedUsd: true },
    });
  });

  it('returns zero-filled stats and does not throw when redis fails', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));
    const stats = await svc.getStats(TENANT);
    expect(stats).toEqual({
      total_hits: 0,
      hit_rate: 0,
      cost_saved_usd: 0,
      top_entries: [],
    });
  });
});
