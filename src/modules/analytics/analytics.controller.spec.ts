import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CacheStats } from '../cache/cache.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT: AuthContext = { tenantId: 't1', apiKeyId: 'k1', plan: 'pro' };

const STATS: CacheStats = {
  hits: 42,
  misses: 158,
  total: 200,
  hitRatePct: 21.0,
  tokensSaved: 12500,
  estimatedCostSavedUsd: 0.025,
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
      hits: 0,
      misses: 0,
      total: 0,
      hitRatePct: 0,
      tokensSaved: 0,
      estimatedCostSavedUsd: 0,
    };
    service.getCacheStats.mockResolvedValue(empty);
    const result = await controller.getCacheStats(TENANT);
    expect(result).toEqual(empty);
  });
});
