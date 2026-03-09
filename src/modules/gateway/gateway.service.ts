import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../common/dto/gateway-response.dto';
import { RoutingDecision } from '../../common/interfaces/routing-decision.interface';
import { RouterService, RouterRequest } from '../router/router.service';
import { AdapterRegistry } from '../providers/registry/adapter.registry';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
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
    @InjectQueue('usage') private readonly usageQueue: Queue,
  ) {}

  async complete(
    dto: ChatCompletionRequestDto,
    ctx: AuthContext,
    xProvider?: string,
    xTag?: string,
  ): Promise<GatewayCompleteResult> {
    const requestId = randomUUID();
    const startMs = Date.now();

    // Build RouterRequest (extends GatewayRequest with router-specific fields)
    const routerRequest: RouterRequest = {
      model: dto.model,
      messages: dto.messages,
      maxTokens: dto.max_tokens,
      temperature: dto.temperature,
      stream: dto.stream,
      tenantId: ctx.tenantId,
      xProvider,
      xTag,
    };

    // Step 1: Resolve provider + model via 5-step waterfall
    const decision = await this.routerService.resolve(
      routerRequest,
      ctx.tenantId,
    );

    // Step 2: Get decrypted API key for the resolved provider
    const apiKey = await this.providerConfigsRepo.getDecryptedApiKey(
      ctx.tenantId,
      decision.provider,
    );

    // Step 3: Get the right adapter and call the provider
    const adapter = this.adapterRegistry.get(decision.provider);

    const gatewayRequest: GatewayRequest = {
      model: decision.model,
      messages: dto.messages,
      maxTokens: dto.max_tokens,
      temperature: dto.temperature,
      stream: false,
      tenantId: ctx.tenantId,
    };

    const response = await adapter.complete(gatewayRequest, apiKey);
    const durationMs = Date.now() - startMs;

    // Step 4: Fire-and-forget usage job — never block the hot path
    const payload: UsageJobPayload = {
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
    };

    void this.usageQueue.add('log-usage', payload).catch((err: unknown) =>
      this.logger.error(
        `Failed to enqueue usage job for request ${requestId}`,
        err,
      ),
    );

    return { response, decision, requestId, durationMs };
  }
}
