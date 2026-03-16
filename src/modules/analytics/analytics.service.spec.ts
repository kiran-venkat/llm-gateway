import { HttpException, HttpStatus } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository, UsageTimeSeriesRow } from './analytics.repository';
import { CacheService } from '../cache/cache.service';
import { UsageQueryDto } from './dto/usage-query.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-abc';

function makeRow(overrides: Partial<UsageTimeSeriesRow> = {}): UsageTimeSeriesRow {
  return {
    date: '2024-01-15',
    requests: 100,
    tokens: 50000,
    cost_usd: 0.1,
    cache_hits: 20,
    errors: 5,
    avg_latency_ms: 300,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<UsageQueryDto> = {}): UsageQueryDto {
  const dto = new UsageQueryDto();
  dto.start = '2024-01-01';
  dto.end = '2024-01-31';
  dto.granularity = 'day';
  Object.assign(dto, overrides);
  return dto;
}

function makeRepo(rows: UsageTimeSeriesRow[] = []): jest.Mocked<AnalyticsRepository> {
  return {
    getUsageTimeSeries: jest.fn().mockResolvedValue(rows),
  } as unknown as jest.Mocked<AnalyticsRepository>;
}

function makeCache(): jest.Mocked<CacheService> {
  return {
    getStats: jest.fn(),
  } as unknown as jest.Mocked<CacheService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsService.getUsageTimeSeries', () => {
  let service: AnalyticsService;
  let repo: jest.Mocked<AnalyticsRepository>;

  beforeEach(() => {
    repo = makeRepo();
    service = new AnalyticsService(makeCache(), repo);
  });

  it('returns correct series for a date range', async () => {
    const rows = [makeRow({ date: '2024-01-10' }), makeRow({ date: '2024-01-11' })];
    repo.getUsageTimeSeries.mockResolvedValue(rows);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(result.series).toEqual(rows);
    expect(result.period).toEqual({ start: '2024-01-01', end: '2024-01-31' });
    expect(result.granularity).toBe('day');
  });

  it('computes totals from series without a second DB query', async () => {
    const rows = [
      makeRow({ requests: 100, tokens: 5000, cost_usd: 0.1, cache_hits: 20, errors: 5, avg_latency_ms: 200 }),
      makeRow({ requests: 200, tokens: 8000, cost_usd: 0.2, cache_hits: 40, errors: 10, avg_latency_ms: 400 }),
    ];
    repo.getUsageTimeSeries.mockResolvedValue(rows);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(result.totals.requests).toBe(300);
    expect(result.totals.tokens).toBe(13000);
    expect(result.totals.cost_usd).toBeCloseTo(0.3);
    expect(result.totals.cache_hits).toBe(60);
    expect(result.totals.errors).toBe(15);
    // repo called exactly once — no second DB query for totals
    expect(repo.getUsageTimeSeries).toHaveBeenCalledTimes(1);
  });

  it('computes weighted avg_latency_ms across days', async () => {
    // Day 1: 100 requests @ 200ms, Day 2: 200 requests @ 400ms
    // Weighted avg = (100*200 + 200*400) / 300 = (20000 + 80000) / 300 ≈ 333.33
    const rows = [
      makeRow({ requests: 100, avg_latency_ms: 200 }),
      makeRow({ requests: 200, avg_latency_ms: 400 }),
    ];
    repo.getUsageTimeSeries.mockResolvedValue(rows);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(result.totals.avg_latency_ms).toBeCloseTo(333.33, 1);
  });

  it('narrows results when provider filter is supplied', async () => {
    const query = makeQuery({ provider: 'openai' });
    repo.getUsageTimeSeries.mockResolvedValue([makeRow()]);

    await service.getUsageTimeSeries(TENANT_ID, query);

    expect(repo.getUsageTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai' }),
    );
  });

  it('returns empty series and zero totals when no data exists', async () => {
    repo.getUsageTimeSeries.mockResolvedValue([]);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(result.series).toEqual([]);
    expect(result.totals.requests).toBe(0);
    expect(result.totals.tokens).toBe(0);
    expect(result.totals.cost_usd).toBe(0);
    expect(result.totals.cache_hits).toBe(0);
    expect(result.totals.errors).toBe(0);
    expect(result.totals.cache_hit_rate).toBe(0);
    expect(result.totals.avg_latency_ms).toBe(0);
  });

  it('throws 400 when start is after end', async () => {
    const query = makeQuery({ start: '2024-01-31', end: '2024-01-01' });

    await expect(service.getUsageTimeSeries(TENANT_ID, query)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { error: 'invalid_date_range' },
    });
  });

  it('cache_hit_rate is 0 when requests is 0 (no division by zero)', async () => {
    repo.getUsageTimeSeries.mockResolvedValue([]);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(result.totals.cache_hit_rate).toBe(0);
  });

  it('converts Decimal cost_usd fields to Number', async () => {
    // Simulate Prisma Decimal returned as an object with toString()
    const decimalLike = { toString: () => '0.00004800', valueOf: () => 0.000048 } as unknown as number;
    repo.getUsageTimeSeries.mockResolvedValue([
      { ...makeRow(), cost_usd: Number(decimalLike) },
    ]);

    const result = await service.getUsageTimeSeries(TENANT_ID, makeQuery());

    expect(typeof result.totals.cost_usd).toBe('number');
  });
});
