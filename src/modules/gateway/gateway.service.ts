import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { Queue } from 'bull';
import { Response } from 'express';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../common/dto/gateway-response.dto';
import { isGatewayError } from '../../common/dto/gateway-error.dto';
import { RoutingDecision } from '../../common/interfaces/routing-decision.interface';
import { RouterService, RouterRequest } from '../router/router.service';
import { AdapterRegistry } from '../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
import { StreamService } from '../stream/stream.service';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';
import { CacheJobData } from '../usage/jobs/cache.job';
import { UsageJobData } from '../usage/jobs/usage.job';
import { CostCalculatorService } from '../usage/cost-calculator.service';

export interface GatewayCompleteResult {
  response: GatewayResponse;
  decision: RoutingDecision;
  requestId: string;
  durationMs: number;
  costUsd: number;
}

@Injectable()
export class GatewayService {
  private readonly logger = new AppLoggerService(GatewayService.name);

  constructor(
    private readonly routerService: RouterService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly providerConfigsRepo: ProviderConfigsRepository,
    private readonly streamService: StreamService,
    @InjectQueue('usage') private readonly usageQueue: Queue,
    @InjectQueue('cache') private readonly cacheQueue: Queue,
    private readonly costCalculator: CostCalculatorService,
  ) {}

  private async resolveAdapter(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    xProvider?: string,
    xTag?: string,
    precomputedDecision?: RoutingDecision,
  ) {
    const decision =
      precomputedDecision ??
      (await this.routerService.resolve(
        {
          model: dto.model,
          messages: dto.messages,
          maxTokens: dto.max_tokens,
          temperature: dto.temperature,
          stream: dto.stream,
          tenantId: ctx.tenantId,
          xProvider,
          xTag,
        } satisfies RouterRequest,
        ctx.tenantId,
      ));
    const apiKey = await this.providerConfigsRepo.getDecryptedApiKey(
      ctx.tenantId,
      decision.provider,
    );
    const adapter = this.adapterRegistry.get(decision.provider);
    return { decision, apiKey, adapter };
  }

  private buildGatewayRequest(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    model: string,
    stream: boolean,
  ): GatewayRequest {
    return {
      model,
      messages: dto.messages,
      maxTokens: dto.max_tokens,
      temperature: dto.temperature,
      stream,
      tenantId: ctx.tenantId,
    };
  }

  private enqueueUsageJob(data: UsageJobData): void {
    void this.usageQueue
      .add('track-usage', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to enqueue usage job', err),
      );
  }

  private async callWithRetry(
    fn: () => Promise<GatewayResponse>,
    requestId: string,
  ): Promise<GatewayResponse> {
    try {
      return await fn();
    } catch (err: unknown) {
      if (isGatewayError(err) && err.retryable) {
        this.logger.warn('Retrying retryable provider error after 500ms', {
          requestId,
          code: err.code,
          provider: err.provider,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        return await fn();
      }
      throw err;
    }
  }

  private enqueueCacheJob(data: CacheJobData): void {
    void this.cacheQueue
      .add('cache-response', data)
      .catch((err: unknown) =>
        this.logger.error('Failed to enqueue cache job', err),
      );
  }

  async complete(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    requestId: string,
    xProvider?: string,
    xTag?: string,
    precomputedDecision?: RoutingDecision,
    cacheKey?: string,
  ): Promise<GatewayCompleteResult> {
    const startMs = Date.now();

    const { decision, apiKey, adapter } = await this.resolveAdapter(
      dto,
      ctx,
      xProvider,
      xTag,
      precomputedDecision,
    );
    const gatewayRequest = this.buildGatewayRequest(
      dto,
      ctx,
      decision.model,
      false,
    );
    const response = await this.callWithRetry(
      () => adapter.complete(gatewayRequest, apiKey),
      requestId,
    );
    const durationMs = Date.now() - startMs;

    // Calculate cost on the hot path so it's available for response headers.
    // The UsageJob re-checks: if costUsd is 0 and status is 'success', it
    // recalculates (safety net for unknown models or pricing cache miss).
    const costUsd = await this.costCalculator.calculateCost(
      response.provider,
      response.model,
      response.promptTokens,
      response.completionTokens,
    );

    this.enqueueUsageJob({
      requestId,
      tenantId: ctx.tenantId,
      apiKeyId: ctx.apiKeyId,
      provider: decision.provider,
      model: decision.model,
      requestedModel: dto.model,
      status: 'success',
      cacheHit: false,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      costUsd,
      latencyMs: durationMs,
      stream: false,
      createdAt: new Date().toISOString(),
    });

    this.logger.log('Request completed', {
      requestId,
      tenantId: ctx.tenantId,
      provider: decision.provider,
      model: decision.model,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      costUsd,
      latencyMs: durationMs,
      cacheHit: false,
    });

    if (cacheKey) {
      this.enqueueCacheJob({
        cacheKey,
        tenantId: ctx.tenantId,
        provider: response.provider,
        model: response.model,
        content: response.content,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        ttlSeconds: 3600,
      });
    }

    return { response, decision, requestId, durationMs, costUsd };
  }

  /**
   * Streaming path — resolves provider, delegates to StreamService.proxy().
   * Does NOT return a value; response is ended inside proxy().
   *
   * Token counts are unavailable until the stream completes, so costUsd is
   * set to 0 in the job payload and the UsageJob recalculates it.
   */
  async completeStream(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    response: Response,
    requestId: string,
    xProvider?: string,
    xTag?: string,
    precomputedDecision?: RoutingDecision,
    cacheKey?: string,
  ): Promise<void> {
    const { decision, apiKey, adapter } = await this.resolveAdapter(
      dto,
      ctx,
      xProvider,
      xTag,
      precomputedDecision,
    );

    // Middleware already set X-Request-Id; set routing headers before flushHeaders()
    response.setHeader('X-Gateway-Provider', decision.provider);
    response.setHeader('X-Gateway-Model', decision.model);
    if (decision.ruleId) {
      response.setHeader('X-Gateway-Rule-Id', decision.ruleId);
    }

    const gatewayRequest = this.buildGatewayRequest(
      dto,
      ctx,
      decision.model,
      true,
    );
    const chunks = adapter.completeStream(gatewayRequest, apiKey);

    await this.streamService.proxy({
      chunks,
      response,
      requestId,
      onComplete: (result) => {
        // onComplete is synchronous — cost is calculated by UsageJob (costUsd=0 triggers it)
        this.enqueueUsageJob({
          requestId,
          tenantId: ctx.tenantId,
          apiKeyId: ctx.apiKeyId,
          provider: decision.provider,
          model: decision.model,
          requestedModel: dto.model,
          status: 'success',
          cacheHit: false,
          promptTokens: 0,
          completionTokens: result.chunkCount,
          costUsd: 0, // recalculated by UsageJob step 1
          latencyMs: result.totalMs,
          ttfbMs: result.firstChunkMs,
          stream: true,
          createdAt: new Date().toISOString(),
        });

        // stream:true bypasses the interceptor so cacheKey is typically undefined
        if (cacheKey) {
          this.enqueueCacheJob({
            cacheKey,
            tenantId: ctx.tenantId,
            provider: decision.provider,
            model: decision.model,
            content: result.content,
            promptTokens: 0,
            completionTokens: result.chunkCount,
            ttlSeconds: 3600,
          });
        }
      },
    });
  }
}
