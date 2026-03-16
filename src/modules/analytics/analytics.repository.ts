import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface UsageTimeSeriesParams {
  tenantId: string;
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
  provider?: string;
  model?: string;
}

export interface UsageTimeSeriesRow {
  date: string;          // YYYY-MM-DD string after conversion
  requests: number;
  tokens: number;
  cost_usd: number;
  cache_hits: number;
  errors: number;
  avg_latency_ms: number;
}

// Shape Postgres returns before Number() conversion
interface RawUsageRow {
  date: unknown;
  requests: unknown;
  tokens: unknown;
  cost_usd: unknown;
  cache_hits: unknown;
  errors: unknown;
  avg_latency_ms: unknown;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getUsageTimeSeries(
    params: UsageTimeSeriesParams,
  ): Promise<UsageTimeSeriesRow[]> {
    const { tenantId, start, end, provider, model } = params;

    const providerFilter = provider
      ? Prisma.sql`AND provider = ${provider}`
      : Prisma.empty;

    const modelFilter = model
      ? Prisma.sql`AND model = ${model}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawUsageRow[]>`
      SELECT
        date::text                            AS date,
        SUM("totalRequests")::int             AS requests,
        SUM("totalTokens")::bigint            AS tokens,
        SUM("totalCostUsd")                   AS cost_usd,
        SUM("cachedRequests")::int            AS cache_hits,
        SUM("errorRequests")::int             AS errors,
        AVG("avgLatencyMs")                   AS avg_latency_ms
      FROM usage_daily
      WHERE "tenantId" = ${tenantId}::uuid
        AND date >= ${start}::date
        AND date <= ${end}::date
        ${providerFilter}
        ${modelFilter}
      GROUP BY date
      ORDER BY date ASC
    `;

    return rows.map((r) => ({
      date: String(r.date),
      requests: Number(r.requests),
      tokens: Number(r.tokens),
      cost_usd: Number(r.cost_usd),
      cache_hits: Number(r.cache_hits),
      errors: Number(r.errors),
      avg_latency_ms: Number(r.avg_latency_ms),
    }));
  }
}
