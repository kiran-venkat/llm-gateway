import { Injectable } from '@nestjs/common';
import { CacheService, CacheStats } from '../cache/cache.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly cacheService: CacheService) {}

  async getCacheStats(tenantId: string): Promise<CacheStats> {
    return this.cacheService.getStats(tenantId);
  }
}
