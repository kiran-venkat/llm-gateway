import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { Queue } from 'bull';
import { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { randomUUID } from 'crypto';
import { CacheService } from './cache.service';
import { buildCacheKey } from './cache-key.util';
import { RouterService, RouterRequest } from '../router/router.service';
import { UsageJobData } from '../usage/jobs/usage.job';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new AppLoggerService(CacheInterceptor.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly routerService: RouterService,
    @InjectQueue('usage') private readonly usageQueue: Queue,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const tenant = req.tenant;
    if (!tenant) {
      return next.handle();
    }

    const body = req.body as {
      model?: string;
      messages?: unknown[];
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
      'x-no-cache'?: boolean;
    };

    // Skip cache for streaming or explicit no-cache
    if (body.stream === true || body['x-no-cache'] === true) {
      return next.handle();
    }

    const xProvider = req.headers['x-provider'] as string | undefined;
    const xTag = req.headers['x-tag'] as string | undefined;

    // Resolve provider to build an accurate cache key
    let decision: import('../../common/interfaces/routing-decision.interface').RoutingDecision;
    try {
      const routerRequest: RouterRequest = {
        model: body.model ?? '',
        messages:
          (body.messages as import('../../common/dto/gateway-request.dto').Message[]) ??
          [],
        maxTokens: body.max_tokens,
        temperature: body.temperature,
        stream: body.stream,
        tenantId: tenant.tenantId,
        xProvider,
        xTag,
      };
      decision = await this.routerService.resolve(
        routerRequest,
        tenant.tenantId,
      );
    } catch (err: unknown) {
      this.logger.error(
        'Router resolution failed in CacheInterceptor, skipping cache',
        err,
      );
      return next.handle();
    }

    // Attach decision to request so GatewayService can reuse it
    req['routingDecision'] = decision;

    const cacheKey = buildCacheKey(tenant.tenantId, {
      provider: decision.provider,
      model: body.model ?? '',
      messages:
        (body.messages as import('../../common/dto/gateway-request.dto').Message[]) ??
        [],
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      tenantId: tenant.tenantId,
    });

    req['cacheKey'] = cacheKey;

    const cached = await this.cacheService.get(cacheKey);

    if (cached) {
      this.logger.log('Cache hit', {
        requestId: req.requestId,
        tenantId: tenant.tenantId,
        cacheKey,
      });
      void this.cacheService.incrementHit(
        tenant.tenantId,
        cached.promptTokens + cached.completionTokens,
      );

      res.setHeader('X-Cache-Hit', 'true');
      res.setHeader('X-Cache-Type', 'exact');
      res.setHeader('X-Gateway-Provider', cached.provider);
      res.setHeader('X-Gateway-Model', cached.model);
      res.setHeader('X-Latency-Ms', '0');

      // Fire-and-forget usage job
      const payload: UsageJobData = {
        requestId: req.requestId,
        tenantId: tenant.tenantId,
        apiKeyId: tenant.apiKeyId,
        provider: cached.provider,
        model: cached.model,
        requestedModel: body.model ?? cached.model,
        status: 'cached',
        cacheHit: true,
        cacheType: 'exact',
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        costUsd: 0,
        latencyMs: 0,
        stream: false,
        createdAt: new Date().toISOString(),
      };
      void this.usageQueue
        .add('track-usage', payload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        })
        .catch((err: unknown) =>
          this.logger.error('Failed to enqueue cache-hit usage job', err),
        );

      res.status(200).json({
        id: `gw-cached-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: cached.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: cached.content },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: cached.promptTokens,
          completion_tokens: cached.completionTokens,
          total_tokens: cached.promptTokens + cached.completionTokens,
        },
      });

      return of(null);
    }

    this.logger.log('Cache miss', {
      requestId: req.requestId,
      tenantId: tenant.tenantId,
      cacheKey,
    });
    res.setHeader('X-Cache-Hit', 'false');
    void this.cacheService.incrementMiss(tenant.tenantId);

    return next.handle();
  }
}
