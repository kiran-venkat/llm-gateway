import { HttpException, HttpStatus } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService, UsageTimeSeriesResponse } from './analytics.service';
import { CacheStats } from '../cache/cache.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { UsageQueryDto } from './dto/usage-query.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT: AuthContext = { tenantId: 't1', apiKeyId: 'k1', plan: 'pro' };

const STATS: CacheStats = {
  total_hits: 42,
  hit_rate: 0.21,
  cost_saved_usd: 0.000025,
  top_entries: [
    { hash: 'abcdef1234567890', hit_count: 10, cost_saved: 0.000012 },
  ],
};

const USAGE_RESPONSE: UsageTimeSeriesResponse = {
  period: { start: '2024-01-01', end: '2024-01-31' },
  granularity: 'day',
  totals: {
    requests: 300,
    tokens: 13000,
    cost_usd: 0.3,
    cache_hits: 60,
    cache_hit_rate: 0.2,
    avg_latency_ms: 333,
    errors: 15,
  },
  series: [],
};

function makeService(): jest.Mocked<AnalyticsService> {
  return {
    getCacheStats: jest.fn().mockResolvedValue(STATS),
    getUsageTimeSeries: jest.fn().mockResolvedValue(USAGE_RESPONSE),
  } as unknown as jest.Mocked<AnalyticsService>;
}

function makeQuery(overrides: Partial<UsageQueryDto> = {}): UsageQueryDto {
  const dto = new UsageQueryDto();
  dto.start = '2024-01-01';
  dto.end = '2024-01-31';
  dto.granularity = 'day';
  Object.assign(dto, overrides);
  return dto;
}

// ---------------------------------------------------------------------------
// Tests — cache endpoint (existing)
// ---------------------------------------------------------------------------

describe('AnalyticsController — GET /analytics/cache', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<AnalyticsService>;

  beforeEach(() => {
    service = makeService();
    controller = new AnalyticsController(service);
  });

  it('returns the stats from AnalyticsService', async () => {
    const result = await controller.getCacheStats(TENANT);
    expect(result).toEqual(STATS);
  });

  it('passes the tenantId to AnalyticsService.getCacheStats', async () => {
    await controller.getCacheStats(TENANT);
    expect(service.getCacheStats).toHaveBeenCalledWith(TENANT.tenantId);
  });

  it('returns zero stats when service returns all zeros', async () => {
    const empty: CacheStats = {
      total_hits: 0,
      hit_rate: 0,
      cost_saved_usd: 0,
      top_entries: [],
    };
    service.getCacheStats.mockResolvedValue(empty);
    const result = await controller.getCacheStats(TENANT);
    expect(result).toEqual(empty);
  });
});

// ---------------------------------------------------------------------------
// Tests — usage endpoint (T39)
// ---------------------------------------------------------------------------

describe('AnalyticsController — GET /analytics/usage', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<AnalyticsService>;

  beforeEach(() => {
    service = makeService();
    controller = new AnalyticsController(service);
  });

  it('returns the usage response from AnalyticsService', async () => {
    const result = await controller.getUsageTimeSeries(TENANT, makeQuery());
    expect(result).toEqual(USAGE_RESPONSE);
  });

  it('passes tenantId and query to AnalyticsService.getUsageTimeSeries', async () => {
    const query = makeQuery({ provider: 'openai' });
    await controller.getUsageTimeSeries(TENANT, query);
    expect(service.getUsageTimeSeries).toHaveBeenCalledWith(TENANT.tenantId, query);
  });

  it('propagates 400 from service when start > end', async () => {
    service.getUsageTimeSeries.mockRejectedValue(
      new HttpException({ error: 'invalid_date_range', message: 'start must not be after end' }, HttpStatus.BAD_REQUEST),
    );
    await expect(
      controller.getUsageTimeSeries(TENANT, makeQuery({ start: '2024-01-31', end: '2024-01-01' })),
    ).rejects.toThrow(HttpException);
  });
});
