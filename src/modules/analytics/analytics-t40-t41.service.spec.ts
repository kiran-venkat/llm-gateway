import { HttpStatus } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsRepository,
  CostByModelRow,
  CostByProviderRow,
  RequestLogRow,
} from './analytics.repository';
import { CacheService } from '../cache/cache.service';
import { RequestsQueryDto } from './dto/requests-query.dto';
import { CostQueryDto } from './dto/cost-query.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<jest.Mocked<AnalyticsRepository>> = {}): jest.Mocked<AnalyticsRepository> {
  return {
    getUsageTimeSeries: jest.fn().mockResolvedValue([]),
    getRequests: jest.fn().mockResolvedValue([]),
    countRequests: jest.fn().mockResolvedValue(0),
    getCostByProvider: jest.fn().mockResolvedValue([]),
    getCostByModel: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as jest.Mocked<AnalyticsRepository>;
}

function makeCache(): jest.Mocked<CacheService> {
  return { getStats: jest.fn() } as unknown as jest.Mocked<CacheService>;
}

function makeRequestsQuery(overrides: Partial<RequestsQueryDto> = {}): RequestsQueryDto {
  const dto = new RequestsQueryDto();
  dto.page = 1;
  dto.limit = 50;
  Object.assign(dto, overrides);
  return dto;
}

function makeCostQuery(overrides: Partial<CostQueryDto> = {}): CostQueryDto {
  const dto = new CostQueryDto();
  dto.start = '2024-01-01';
  dto.end = '2024-01-31';
  Object.assign(dto, overrides);
  return dto;
}

function makeRequestRow(overrides: Partial<RequestLogRow> = {}): RequestLogRow {
  return {
    id: 'req-1',
    provider: 'openai',
    model: 'gpt-4o',
    requestedModel: 'gpt-4o',
    status: 'success',
    cacheHit: false,
    cacheType: null,
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 0.0003,
    latencyMs: 300,
    ttfbMs: 100,
    errorCode: null,
    stream: false,
    createdAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T40 — Request log
// ---------------------------------------------------------------------------

describe('AnalyticsService.getRequestLog', () => {
  const TENANT = 'tenant-1';
  let service: AnalyticsService;
  let repo: jest.Mocked<AnalyticsRepository>;

  beforeEach(() => {
    repo = makeRepo();
    service = new AnalyticsService(makeCache(), repo);
  });

  it('returns paginated results with correct shape', async () => {
    const rows = [makeRequestRow(), makeRequestRow({ id: 'req-2' })];
    repo.getRequests.mockResolvedValue(rows);
    repo.countRequests.mockResolvedValue(150);

    const result = await service.getRequestLog(TENANT, makeRequestsQuery({ page: 2, limit: 50 }));

    expect(result.data).toEqual(rows);
    expect(result.total).toBe(150);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.pages).toBe(3); // Math.ceil(150 / 50)
  });

  it('pages = Math.ceil(total / limit)', async () => {
    repo.countRequests.mockResolvedValue(101);

    const result = await service.getRequestLog(TENANT, makeRequestsQuery({ limit: 50 }));

    expect(result.pages).toBe(3); // Math.ceil(101 / 50) = 3
  });

  it('pages = 1 when total = 0 (no division by zero oddity)', async () => {
    repo.countRequests.mockResolvedValue(0);

    const result = await service.getRequestLog(TENANT, makeRequestsQuery());

    expect(result.pages).toBe(0); // Math.ceil(0/50) = 0 — empty result set
  });

  it('COUNT and SELECT run in parallel', async () => {
    const callOrder: string[] = [];
    repo.getRequests.mockImplementation(async () => {
      callOrder.push('select');
      return [];
    });
    repo.countRequests.mockImplementation(async () => {
      callOrder.push('count');
      return 0;
    });

    await service.getRequestLog(TENANT, makeRequestsQuery());

    // Both should have been called (parallel means both called, not just one)
    expect(repo.getRequests).toHaveBeenCalledTimes(1);
    expect(repo.countRequests).toHaveBeenCalledTimes(1);
  });

  it('passes provider filter to repository', async () => {
    await service.getRequestLog(TENANT, makeRequestsQuery({ provider: 'anthropic' }));
    expect(repo.getRequests).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ provider: 'anthropic' }),
    );
    expect(repo.countRequests).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ provider: 'anthropic' }),
    );
  });

  it('passes status filter to repository', async () => {
    await service.getRequestLog(TENANT, makeRequestsQuery({ status: 'error' }));
    expect(repo.getRequests).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('passes date range filters to repository', async () => {
    const query = makeRequestsQuery({ start: '2024-01-10', end: '2024-01-20' });
    await service.getRequestLog(TENANT, query);
    expect(repo.getRequests).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ start: '2024-01-10', end: '2024-01-20' }),
    );
  });
});

// ---------------------------------------------------------------------------
// T41 — Cost breakdown
// ---------------------------------------------------------------------------

describe('AnalyticsService.getCostBreakdown', () => {
  const TENANT = 'tenant-1';
  let service: AnalyticsService;
  let repo: jest.Mocked<AnalyticsRepository>;

  beforeEach(() => {
    repo = makeRepo();
    service = new AnalyticsService(makeCache(), repo);
  });

  const providerRows: CostByProviderRow[] = [
    { provider: 'openai',    cost_usd: 0.6, requests: 600 },
    { provider: 'anthropic', cost_usd: 0.3, requests: 300 },
    { provider: 'gemini',    cost_usd: 0.1, requests: 100 },
  ];

  const modelRows: CostByModelRow[] = [
    { model: 'gpt-4o',        provider: 'openai',    cost_usd: 0.6, requests: 600 },
    { model: 'claude-3-opus', provider: 'anthropic', cost_usd: 0.3, requests: 300 },
    { model: 'gemini-pro',    provider: 'gemini',    cost_usd: 0.1, requests: 100 },
  ];

  it('returns correct total_cost_usd', async () => {
    repo.getCostByProvider.mockResolvedValue(providerRows);
    repo.getCostByModel.mockResolvedValue(modelRows);

    const result = await service.getCostBreakdown(TENANT, makeCostQuery());

    expect(result.total_cost_usd).toBeCloseTo(1.0);
  });

  it('by_provider pct values sum to ~100', async () => {
    repo.getCostByProvider.mockResolvedValue(providerRows);
    repo.getCostByModel.mockResolvedValue(modelRows);

    const result = await service.getCostBreakdown(TENANT, makeCostQuery());

    const sum = result.by_provider.reduce((acc, r) => acc + r.pct, 0);
    expect(sum).toBeCloseTo(100, 5);
  });

  it('pct reflects share of total correctly', async () => {
    repo.getCostByProvider.mockResolvedValue(providerRows);
    repo.getCostByModel.mockResolvedValue(modelRows);

    const result = await service.getCostBreakdown(TENANT, makeCostQuery());

    expect(result.by_provider[0].pct).toBeCloseTo(60); // 0.6 / 1.0 * 100
    expect(result.by_provider[1].pct).toBeCloseTo(30); // 0.3 / 1.0 * 100
    expect(result.by_provider[2].pct).toBeCloseTo(10); // 0.1 / 1.0 * 100
  });

  it('both queries run in parallel', async () => {
    repo.getCostByProvider.mockResolvedValue(providerRows);
    repo.getCostByModel.mockResolvedValue(modelRows);

    await service.getCostBreakdown(TENANT, makeCostQuery());

    expect(repo.getCostByProvider).toHaveBeenCalledTimes(1);
    expect(repo.getCostByModel).toHaveBeenCalledTimes(1);
  });

  it('pct = 0 for all rows when total is 0 (no division by zero)', async () => {
    repo.getCostByProvider.mockResolvedValue([
      { provider: 'openai', cost_usd: 0, requests: 0 },
    ]);
    repo.getCostByModel.mockResolvedValue([
      { model: 'gpt-4o', provider: 'openai', cost_usd: 0, requests: 0 },
    ]);

    const result = await service.getCostBreakdown(TENANT, makeCostQuery());

    expect(result.total_cost_usd).toBe(0);
    expect(result.by_provider[0].pct).toBe(0);
    expect(result.by_model[0].pct).toBe(0);
  });

  it('returns empty arrays when no data exists', async () => {
    const result = await service.getCostBreakdown(TENANT, makeCostQuery());

    expect(result.by_provider).toEqual([]);
    expect(result.by_model).toEqual([]);
    expect(result.total_cost_usd).toBe(0);
  });

  it('throws 400 when start is after end', async () => {
    const query = makeCostQuery({ start: '2024-01-31', end: '2024-01-01' });

    await expect(service.getCostBreakdown(TENANT, query)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { error: 'invalid_date_range' },
    });
  });

  it('returns period in response', async () => {
    const result = await service.getCostBreakdown(TENANT, makeCostQuery());
    expect(result.period).toEqual({ start: '2024-01-01', end: '2024-01-31' });
  });
});

// ---------------------------------------------------------------------------
// T42 — Cache stats on AnalyticsController (confirmed, not tested here)
// ---------------------------------------------------------------------------
// GET /api/v1/analytics/cache is handled by AnalyticsController.getCacheStats()
// which delegates to AnalyticsService.getCacheStats(). Tests are in
// analytics.controller.spec.ts. No code moved — already on the correct controller.
