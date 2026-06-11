import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestsQueryDto } from './dto/requests-query.dto';

// ---------------------------------------------------------------------------
// T39 — Usage time series
// ---------------------------------------------------------------------------

export interface UsageTimeSeriesParams {
  tenantId: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  provider?: string;
  model?: string;
}

export interface UsageTimeSeriesRow {
  date: string; // YYYY-MM-DD string after conversion
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

// ---------------------------------------------------------------------------
// T40 — Request log
// ---------------------------------------------------------------------------

export interface RequestLogRow {
  id: string;
  provider: string;
  model: string;
  requestedModel: string;
  status: string;
  cacheHit: boolean;
  cacheType: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  ttfbMs: number | null;
  errorCode: string | null;
  stream: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// T41 — Cost breakdown
// ---------------------------------------------------------------------------

export interface CostByProviderRow {
  provider: string;
  cost_usd: number;
  requests: number;
}

export interface CostByModelRow {
  model: string;
  provider: string;
  cost_usd: number;
  requests: number;
}

interface RawCostByProviderRow {
  provider: unknown;
  cost_usd: unknown;
  requests: unknown;
}

interface RawCostByModelRow {
  model: unknown;
  provider: unknown;
  cost_usd: unknown;
  requests: unknown;
}

// ---------------------------------------------------------------------------

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // T39
  // -------------------------------------------------------------------------

  async getUsageTimeSeries(
    params: UsageTimeSeriesParams,
  ): Promise<UsageTimeSeriesRow[]> {
    const { tenantId, start, end, provider, model } = params;

    const providerFilter = provider
      ? Prisma.sql`AND provider = ${provider}`
      : Prisma.empty;

    const modelFilter = model ? Prisma.sql`AND model = ${model}` : Prisma.empty;

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

    // $queryRaw returns DECIMAL/NUMERIC columns as opaque Prisma Decimal objects, not plain JS
    // numbers. JSON.stringify(Decimal) produces { "d": [...] } — the internal representation —
    // not a numeric literal. Number() converts each field to a plain number before returning.
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

  // -------------------------------------------------------------------------
  // T40
  // -------------------------------------------------------------------------

  /**
   * Build a Prisma where clause from the optional request log filters.
   * Shared by getRequests() and countRequests() to guarantee filter parity.
   */
  private buildRequestWhere(
    tenantId: string,
    params: Pick<RequestsQueryDto, 'provider' | 'status' | 'start' | 'end'>,
  ): Prisma.RequestWhereInput {
    return {
      tenantId,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.start || params.end
        ? {
            createdAt: {
              ...(params.start ? { gte: new Date(params.start) } : {}),
              // Use end-of-day so "2024-01-31" includes all requests on that date
              ...(params.end
                ? { lte: new Date(params.end + 'T23:59:59.999Z') }
                : {}),
            },
          }
        : {}),
    };
  }

  async getRequests(
    tenantId: string,
    params: RequestsQueryDto,
  ): Promise<RequestLogRow[]> {
    const where = this.buildRequestWhere(tenantId, params);
    const skip = (params.page - 1) * params.limit;

    const rows = await this.prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip,
      select: {
        id: true,
        provider: true,
        model: true,
        requestedModel: true,
        status: true,
        cacheHit: true,
        cacheType: true,
        promptTokens: true,
        completionTokens: true,
        costUsd: true,
        latencyMs: true,
        ttfbMs: true,
        errorCode: true,
        stream: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      requestedModel: r.requestedModel,
      status: r.status,
      cacheHit: r.cacheHit,
      cacheType: r.cacheType ?? null,
      promptTokens: r.promptTokens ?? null,
      completionTokens: r.completionTokens ?? null,
      // Prisma wraps DECIMAL columns in a Decimal object even on typed ORM queries; Number() required.
      costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
      latencyMs: r.latencyMs ?? null,
      ttfbMs: r.ttfbMs ?? null,
      errorCode: r.errorCode ?? null,
      stream: r.stream,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async countRequests(
    tenantId: string,
    params: Pick<RequestsQueryDto, 'provider' | 'status' | 'start' | 'end'>,
  ): Promise<number> {
    const where = this.buildRequestWhere(tenantId, params);
    return this.prisma.request.count({ where });
  }

  // -------------------------------------------------------------------------
  // T41
  // -------------------------------------------------------------------------

  async getCostByProvider(
    tenantId: string,
    start: string,
    end: string,
  ): Promise<CostByProviderRow[]> {
    const rows = await this.prisma.$queryRaw<RawCostByProviderRow[]>`
      SELECT
        provider,
        SUM("totalCostUsd")   AS cost_usd,
        SUM("totalRequests")  AS requests
      FROM usage_daily
      WHERE "tenantId" = ${tenantId}::uuid
        AND date >= ${start}::date
        AND date <= ${end}::date
      GROUP BY provider
      ORDER BY cost_usd DESC
    `;

    // $queryRaw returns DECIMAL/NUMERIC columns as opaque Prisma Decimal objects, not plain JS
    // numbers. JSON.stringify(Decimal) produces { "d": [...] } — the internal representation —
    // not a numeric literal. Number() converts each field to a plain number before returning.
    return rows.map((r) => ({
      provider: String(r.provider),
      cost_usd: Number(r.cost_usd),
      requests: Number(r.requests),
    }));
  }

  async getCostByModel(
    tenantId: string,
    start: string,
    end: string,
  ): Promise<CostByModelRow[]> {
    const rows = await this.prisma.$queryRaw<RawCostByModelRow[]>`
      SELECT
        model,
        provider,
        SUM("totalCostUsd")   AS cost_usd,
        SUM("totalRequests")  AS requests
      FROM usage_daily
      WHERE "tenantId" = ${tenantId}::uuid
        AND date >= ${start}::date
        AND date <= ${end}::date
      GROUP BY model, provider
      ORDER BY cost_usd DESC
    `;

    // $queryRaw returns DECIMAL/NUMERIC columns as opaque Prisma Decimal objects, not plain JS
    // numbers. JSON.stringify(Decimal) produces { "d": [...] } — the internal representation —
    // not a numeric literal. Number() converts each field to a plain number before returning.
    return rows.map((r) => ({
      model: String(r.model),
      provider: String(r.provider),
      cost_usd: Number(r.cost_usd),
      requests: Number(r.requests),
    }));
  }
}
