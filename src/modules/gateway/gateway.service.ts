import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Response } from 'express';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../common/dto/gateway-response.dto';
import { RoutingDecision } from '../../common/interfaces/routing-decision.interface';
import { RouterService, RouterRequest } from '../router/router.service';
import { AdapterRegistry } from '../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
import { StreamService } from '../stream/stream.service';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

export interface UsageJobPayload {
  requestId: string;
  tenantId: string;
  provider: string;
  model: string;
  ruleId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  finishReason: string;
  stream?: boolean;
  cacheHit?: boolean;
}

export interface GatewayCompleteResult {
  response: GatewayResponse;
  decision: RoutingDecision;
  requestId: string;
  durationMs: number;
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly routerService: RouterService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly providerConfigsRepo: ProviderConfigsRepository,
    private readonly streamService: StreamService,
    @InjectQueue('usage') private readonly usageQueue: Queue,
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

  private enqueueUsageJob(payload: UsageJobPayload): void {
    void this.usageQueue
      .add('log-usage', payload)
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to enqueue usage job for request ${payload.requestId}`,
          err,
        ),
      );
  }

  async complete(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    requestId: string,
    xProvider?: string,
    xTag?: string,
    precomputedDecision?: RoutingDecision,
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
    const response = await adapter.complete(gatewayRequest, apiKey);
    const durationMs = Date.now() - startMs;

    this.enqueueUsageJob({
      requestId,
      tenantId: ctx.tenantId,
      provider: decision.provider,
      model: decision.model,
      ruleId: decision.ruleId,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      totalTokens: response.totalTokens,
      durationMs,
      finishReason: response.finishReason,
    });

    return { response, decision, requestId, durationMs };
  }

  /**
   * Streaming path — resolves provider, delegates to StreamService.proxy().
   * Does NOT return a value; response is ended inside proxy().
   */
  async completeStream(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    response: Response,
    requestId: string,
    xProvider?: string,
    xTag?: string,
    precomputedDecision?: RoutingDecision,
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
        this.enqueueUsageJob({
          requestId,
          tenantId: ctx.tenantId,
          provider: decision.provider,
          model: decision.model,
          ruleId: decision.ruleId,
          promptTokens: 0,
          completionTokens: result.chunkCount,
          totalTokens: result.chunkCount,
          durationMs: result.totalMs,
          finishReason: 'stop',
          stream: true,
        });
      },
    });
  }
}
