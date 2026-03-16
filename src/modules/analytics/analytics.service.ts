import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CacheService, CacheStats } from '../cache/cache.service';
import {
  AnalyticsRepository,
  CostByModelRow,
  CostByProviderRow,
  RequestLogRow,
  UsageTimeSeriesRow,
} from './analytics.repository';
import { CostQueryDto } from './dto/cost-query.dto';
import { RequestsQueryDto } from './dto/requests-query.dto';
import { UsageQueryDto } from './dto/usage-query.dto';

// ---------------------------------------------------------------------------
// T39 — Usage time series
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// T40 — Request log
// ---------------------------------------------------------------------------

export interface RequestLogResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ---------------------------------------------------------------------------
// T41 — Cost breakdown
// ---------------------------------------------------------------------------

export interface CostByProviderEntry extends CostByProviderRow {
  pct: number;
}

export interface CostByModelEntry extends CostByModelRow {
  pct: number;
}

export interface CostBreakdownResponse {
  period: { start: string; end: string };
  total_cost_usd: number;
  by_provider: CostByProviderEntry[];
  by_model: CostByModelEntry[];
}

// ---------------------------------------------------------------------------

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly analyticsRepository: AnalyticsRepository,
  ) {}

  // -------------------------------------------------------------------------
  // T33
  // -------------------------------------------------------------------------

  async getCacheStats(tenantId: string): Promise<CacheStats> {
    return this.cacheService.getStats(tenantId);
  }

  // -------------------------------------------------------------------------
  // T39
  // -------------------------------------------------------------------------

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

    const totals = this.computeUsageTotals(series);

    return { period: { start, end }, granularity, totals, series };
  }

  private computeUsageTotals(series: UsageTimeSeriesRow[]): UsageTotals {
    const base = series.reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        tokens: acc.tokens + row.tokens,
        cost_usd: acc.cost_usd + row.cost_usd,
        cache_hits: acc.cache_hits + row.cache_hits,
        errors: acc.errors + row.errors,
        // Weighted latency accumulator — divided by total requests below
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

  // -------------------------------------------------------------------------
  // T40
  // -------------------------------------------------------------------------

  async getRequestLog(
    tenantId: string,
    query: RequestsQueryDto,
  ): Promise<RequestLogResponse<RequestLogRow>> {
    const [data, total] = await Promise.all([
      this.analyticsRepository.getRequests(tenantId, query),
      this.analyticsRepository.countRequests(tenantId, query),
    ]);

    const pages = Math.ceil(total / query.limit);

    return { data, total, page: query.page, limit: query.limit, pages };
  }

  // -------------------------------------------------------------------------
  // T41
  // -------------------------------------------------------------------------

  async getCostBreakdown(
    tenantId: string,
    query: CostQueryDto,
  ): Promise<CostBreakdownResponse> {
    const { start, end } = query;

    if (new Date(start) > new Date(end)) {
      throw new HttpException(
        { error: 'invalid_date_range', message: 'start must not be after end' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Both GROUP BY queries run in parallel — neither depends on the other
    const [byProviderRaw, byModelRaw] = await Promise.all([
      this.analyticsRepository.getCostByProvider(tenantId, start, end),
      this.analyticsRepository.getCostByModel(tenantId, start, end),
    ]);

    // total_cost_usd derived from by_provider rows (no third DB query)
    const total_cost_usd = byProviderRaw.reduce(
      (sum, r) => sum + r.cost_usd,
      0,
    );

    // pct = this row's cost / total * 100; 0 when total is 0 (no division by zero)
    const by_provider: CostByProviderEntry[] = byProviderRaw.map((r) => ({
      ...r,
      pct: total_cost_usd > 0 ? (r.cost_usd / total_cost_usd) * 100 : 0,
    }));

    const by_model: CostByModelEntry[] = byModelRaw.map((r) => ({
      ...r,
      pct: total_cost_usd > 0 ? (r.cost_usd / total_cost_usd) * 100 : 0,
    }));

    return { period: { start, end }, total_cost_usd, by_provider, by_model };
  }
}
