import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CacheStats } from '../cache/cache.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

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

function makeService(): jest.Mocked<AnalyticsService> {
  return {
    getCacheStats: jest.fn().mockResolvedValue(STATS),
  } as unknown as jest.Mocked<AnalyticsService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsController', () => {
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
