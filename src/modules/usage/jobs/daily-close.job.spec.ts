import { Job, Queue } from 'bull';
import { Redis } from 'ioredis';
import { DailyCloseJob } from './daily-close.job';
import { computePercentile } from '../../../common/utils/percentile.util';
import { UsageRepository } from '../usage.repository';

// ---------------------------------------------------------------------------
// computePercentile pure-function tests
// ---------------------------------------------------------------------------

describe('computePercentile', () => {
  it('returns 0 for empty array', () => {
    expect(computePercentile([], 95)).toBe(0);
  });

  it('returns the only element for a single-element array', () => {
    expect(computePercentile([200], 95)).toBe(200);
    expect(computePercentile([200], 50)).toBe(200);
  });

  it('computes p95 correctly for 20 values [10, 20, …, 200]', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    // rank = ceil(0.95 * 20) = ceil(19) = 19 → index 18 → value 190
    expect(computePercentile(sorted, 95)).toBe(190);
  });

  it('computes p50 correctly for 20 values [10, 20, …, 200]', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    // rank = ceil(0.50 * 20) = ceil(10) = 10 → index 9 → value 100
    expect(computePercentile(sorted, 50)).toBe(100);
  });

  it('computes p95 for 100 values [1..100]', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    // rank = ceil(0.95 * 100) = 95 → index 94 → value 95
    expect(computePercentile(sorted, 95)).toBe(95);
  });

  it('returns the max element for p100', () => {
    const sorted = [50, 100, 150, 200, 300];
    expect(computePercentile(sorted, 100)).toBe(300);
  });

  it('returns the min element for p1 with a small array', () => {
    const sorted = [10, 20, 30];
    // rank = ceil(0.01 * 3) = ceil(0.03) = 1 → index 0 → value 10
    expect(computePercentile(sorted, 1)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// DailyCloseJob.process tests
// ---------------------------------------------------------------------------

function makeUsageRepo(): jest.Mocked<
  Pick<UsageRepository, 'getUsageDailyRows' | 'updateLatencyStats'>
> {
  return {
    getUsageDailyRows: jest.fn().mockResolvedValue([]),
    updateLatencyStats: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<
    Pick<UsageRepository, 'getUsageDailyRows' | 'updateLatencyStats'>
  >;
}

function makeRedis(): jest.Mocked<Pick<Redis, 'zrangebyscore' | 'del'>> {
  return {
    zrangebyscore: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<Pick<Redis, 'zrangebyscore' | 'del'>>;
}

function makeQueue(): jest.Mocked<Pick<Queue, 'add'>> {
  return {
    add: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<Queue, 'add'>>;
}

function makeJob(date: string): Job<{ date: string }> {
  return { data: { date } } as Job<{ date: string }>;
}

/**
 * Encodes latency samples as ioredis ZRANGEBYSCORE WITHSCORES response:
 * [member1, score1, member2, score2, ...]
 */
function encodeZrangeResult(latencies: number[]): string[] {
  return latencies.flatMap((ms, i) => [`req-${i}`, String(ms)]);
}

describe('DailyCloseJob.process', () => {
  let usageRepo: ReturnType<typeof makeUsageRepo>;
  let mockRedis: ReturnType<typeof makeRedis>;
  let mockQueue: ReturnType<typeof makeQueue>;
  let job: DailyCloseJob;

  const date = '2026-03-15';
  const tenantId = 'tenant-11111111-2222-3333-4444-555555555555';
  const provider = 'openai';
  const model = 'gpt-4o-mini';
  const redisKey = `tenant:${tenantId}:latency:${provider}:${model}:${date}`;

  beforeEach(() => {
    usageRepo = makeUsageRepo();
    mockRedis = makeRedis();
    mockQueue = makeQueue();
    job = new DailyCloseJob(
      usageRepo as unknown as UsageRepository,
      mockRedis as unknown as Redis,
      mockQueue as unknown as Queue,
    );
  });

  it('skips silently when no usage_daily rows exist for the date', async () => {
    usageRepo.getUsageDailyRows.mockResolvedValue([]);
    await job.process(makeJob(date));
    expect(usageRepo.updateLatencyStats).not.toHaveBeenCalled();
  });

  it('skips a row when its Redis sorted set is empty', async () => {
    usageRepo.getUsageDailyRows.mockResolvedValue([
      { tenantId, provider, model },
    ]);
    mockRedis.zrangebyscore.mockResolvedValue([]);

    await job.process(makeJob(date));

    expect(usageRepo.updateLatencyStats).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('computes correct p95 and avg and calls updateLatencyStats', async () => {
    usageRepo.getUsageDailyRows.mockResolvedValue([
      { tenantId, provider, model },
    ]);
    // 20 samples: [10, 20, …, 200]
    const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    mockRedis.zrangebyscore.mockResolvedValue(encodeZrangeResult(latencies));

    await job.process(makeJob(date));

    // p95 of [10..200] step 10 = 190 (rank=19, index=18)
    // avg = (10+20+…+200)/20 = 2100/20 = 105
    expect(usageRepo.updateLatencyStats).toHaveBeenCalledWith(
      tenantId,
      provider,
      model,
      date,
      190, // Math.round(p95)
      105, // avg
    );
  });

  it('deletes the Redis key after updating', async () => {
    usageRepo.getUsageDailyRows.mockResolvedValue([
      { tenantId, provider, model },
    ]);
    mockRedis.zrangebyscore.mockResolvedValue(
      encodeZrangeResult([100, 200, 300]),
    );

    await job.process(makeJob(date));

    expect(mockRedis.del).toHaveBeenCalledWith(redisKey);
  });

  it('is idempotent: second run finds empty sorted set and skips', async () => {
    usageRepo.getUsageDailyRows.mockResolvedValue([
      { tenantId, provider, model },
    ]);
    // First call: has data; second call: empty (key was deleted by first run)
    mockRedis.zrangebyscore
      .mockResolvedValueOnce(encodeZrangeResult([100, 200, 300]))
      .mockResolvedValueOnce([]);

    await job.process(makeJob(date));
    await job.process(makeJob(date));

    // updateLatencyStats called once (first run), not twice
    expect(usageRepo.updateLatencyStats).toHaveBeenCalledTimes(1);
  });

  it('processes multiple (provider, model) rows independently', async () => {
    const row2 = {
      tenantId,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    };
    usageRepo.getUsageDailyRows.mockResolvedValue([
      { tenantId, provider, model },
      row2,
    ]);
    mockRedis.zrangebyscore
      .mockResolvedValueOnce(encodeZrangeResult([100, 200, 300]))
      .mockResolvedValueOnce(encodeZrangeResult([50, 150, 250]));

    await job.process(makeJob(date));

    expect(usageRepo.updateLatencyStats).toHaveBeenCalledTimes(2);
    expect(mockRedis.del).toHaveBeenCalledTimes(2);
  });
});
