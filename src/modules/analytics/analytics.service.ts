import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CacheService, CacheStats } from '../cache/cache.service';
import {
  AnalyticsRepository,
  UsageTimeSeriesRow,
} from './analytics.repository';
import { UsageQueryDto } from './dto/usage-query.dto';

export interface UsageTotals {
  requests: number;
  tokens: number;
  cost_usd: number;
  cache_hits: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
  errors: number;
}

export interface UsageTimeSeriesResponse {
  period: { start: string; end: string };
  granularity: 'day' | 'hour';
  totals: UsageTotals;
  series: UsageTimeSeriesRow[];
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly analyticsRepository: AnalyticsRepository,
  ) {}

  async getCacheStats(tenantId: string): Promise<CacheStats> {
    return this.cacheService.getStats(tenantId);
  }

  async getUsageTimeSeries(
    tenantId: string,
    query: UsageQueryDto,
  ): Promise<UsageTimeSeriesResponse> {
    const { start, end, granularity, provider, model } = query;

    if (new Date(start) > new Date(end)) {
      throw new HttpException(
        { error: 'invalid_date_range', message: 'start must not be after end' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const series = await this.analyticsRepository.getUsageTimeSeries({
      tenantId,
      start,
      end,
      provider,
      model,
    });

    const totals = this.computeTotals(series);

    return { period: { start, end }, granularity, totals, series };
  }

  private computeTotals(series: UsageTimeSeriesRow[]): UsageTotals {
    const base = series.reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        tokens: acc.tokens + row.tokens,
        cost_usd: acc.cost_usd + row.cost_usd,
        cache_hits: acc.cache_hits + row.cache_hits,
        errors: acc.errors + row.errors,
        // Weighted latency sum — divided by total requests below
        latency_weight: acc.latency_weight + row.avg_latency_ms * row.requests,
      }),
      {
        requests: 0,
        tokens: 0,
        cost_usd: 0,
        cache_hits: 0,
        errors: 0,
        latency_weight: 0,
      },
    );

    const cache_hit_rate =
      base.requests > 0 ? base.cache_hits / base.requests : 0;

    const avg_latency_ms =
      base.requests > 0 ? base.latency_weight / base.requests : 0;

    return {
      requests: base.requests,
      tokens: base.tokens,
      cost_usd: base.cost_usd,
      cache_hits: base.cache_hits,
      cache_hit_rate,
      avg_latency_ms,
      errors: base.errors,
    };
  }
}
