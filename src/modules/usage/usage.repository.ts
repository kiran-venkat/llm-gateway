import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageJobData } from './jobs/usage.job';

@Injectable()
export class UsageRepository {
  private readonly logger = new Logger(UsageRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert a row into the requests table.
   *
   * Uses the pre-generated requestId as the PK so that the X-Request-Id
   * response header and the DB record share the same identifier — logs,
   * dashboards, and client traces can all correlate by a single ID.
   */
  async createRequest(data: UsageJobData): Promise<void> {
    await this.prisma.request.create({
      data: {
        id: data.requestId,
        tenantId: data.tenantId,
        apiKeyId: data.apiKeyId,
        provider: data.provider,
        model: data.model,
        requestedModel: data.requestedModel,
        status: data.status,
        cacheHit: data.cacheHit,
        cacheType: data.cacheType ?? null,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        totalTokens: data.promptTokens + data.completionTokens,
        costUsd: data.costUsd,
        latencyMs: data.latencyMs,
        ttfbMs: data.ttfbMs ?? null,
        stream: data.stream,
        errorCode: data.errorCode ?? null,
        createdAt: new Date(data.createdAt),
      },
    });
  }

  /**
   * Atomically increment daily usage aggregates.
   *
   * Prisma's upsert() cannot express increment-on-conflict semantics
   * (it would overwrite counters, not add to them). Raw SQL with
   * ON CONFLICT DO UPDATE SET field = table.field + delta is the
   * correct and only safe approach here.
   *
   * Rolling average formula:
   *   new_avg = (old_avg * old_count + new_value) / (old_count + 1)
   * Applied before the totalRequests increment so old_count is correct.
   */
  /**
   * Creates a RequestSpan row for session tracing.
   * Must be called after createRequest() so the FK constraint on requestId is satisfied.
   */
  async createRequestSpan(data: {
    sessionId: string;
    tenantId: string;
    requestId: string;
    userLabel?: string;
    parentRequestId?: string;
  }): Promise<void> {
    await this.prisma.requestSpan.create({
      data: {
        sessionId: data.sessionId,
        tenantId: data.tenantId,
        requestId: data.requestId,
        userLabel: data.userLabel ?? null,
        parentRequestId: data.parentRequestId ?? null,
      },
    });
  }

  /**
   * Returns all (tenantId, provider, model) rows in usage_daily for a specific date.
   * Used by DailyCloseJob to enumerate which Redis latency sorted sets to process.
   */
  async getUsageDailyRows(
    date: string,
  ): Promise<Array<{ tenantId: string; provider: string; model: string }>> {
    return this.prisma.usageDaily.findMany({
      where: { date: new Date(date) },
      select: { tenantId: true, provider: true, model: true },
    });
  }

  /**
   * Updates p95LatencyMs and avgLatencyMs for a specific (tenantId, provider, model, date) row.
   * Called by DailyCloseJob after computing exact percentiles from Redis sorted set samples.
   */
  async updateLatencyStats(
    tenantId: string,
    provider: string,
    model: string,
    date: string,
    p95LatencyMs: number,
    avgLatencyMs: number,
  ): Promise<void> {
    await this.prisma.usageDaily.update({
      where: {
        tenantId_provider_model_date: {
          tenantId,
          provider,
          model,
          date: new Date(date),
        },
      },
      data: { p95LatencyMs, avgLatencyMs },
    });
  }

  async upsertDailyUsage(data: UsageJobData): Promise<void> {
    const date = new Date(data.createdAt).toISOString().split('T')[0]; // YYYY-MM-DD
    const rowId = randomUUID();
    const totalTokens = data.promptTokens + data.completionTokens;
    const isSuccess = data.status === 'success' ? 1 : 0;
    const isCached = data.cacheHit ? 1 : 0;
    const isError = data.status === 'error' ? 1 : 0;

    await this.prisma.$executeRaw`
      INSERT INTO usage_daily (
        "id", "tenantId", "provider", "model", "date",
        "totalRequests", "successfulRequests", "cachedRequests", "errorRequests",
        "totalTokens", "promptTokens", "completionTokens",
        "totalCostUsd", "avgLatencyMs", "updatedAt"
      ) VALUES (
        ${rowId}::uuid, ${data.tenantId}::uuid, ${data.provider}, ${data.model}, ${date}::date,
        1,
        ${isSuccess}, ${isCached}, ${isError},
        ${totalTokens}, ${data.promptTokens}, ${data.completionTokens},
        ${data.costUsd}, ${data.latencyMs}, NOW()
      )
      ON CONFLICT ("tenantId", "provider", "model", "date")
      DO UPDATE SET
        "totalRequests"      = usage_daily."totalRequests" + 1,
        "successfulRequests" = usage_daily."successfulRequests" + ${isSuccess},
        "cachedRequests"     = usage_daily."cachedRequests" + ${isCached},
        "errorRequests"      = usage_daily."errorRequests" + ${isError},
        "totalTokens"        = usage_daily."totalTokens" + ${totalTokens},
        "promptTokens"       = usage_daily."promptTokens" + ${data.promptTokens},
        "completionTokens"   = usage_daily."completionTokens" + ${data.completionTokens},
        "totalCostUsd"       = usage_daily."totalCostUsd" + ${data.costUsd},
        "avgLatencyMs"       = (COALESCE(usage_daily."avgLatencyMs", 0) * usage_daily."totalRequests" + ${data.latencyMs}) / (usage_daily."totalRequests" + 1),
        "updatedAt"          = NOW()
    `;
  }
}
