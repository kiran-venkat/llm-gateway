import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Request } from 'express';
import { Redis } from 'ioredis';
import { AuthContext } from '../interfaces/auth-context.interface';
import { RateLimitService } from '../../modules/rate-limit/rate-limit.service';
import { ProviderConfigsRepository } from '../../modules/providers/provider-configs.repository';
import { AdapterRegistry } from '../../modules/providers/registry/adapter.registry';
import {
  MODEL_PREFIX_MAP,
  MODEL_PROVIDER_MAP,
} from '../../modules/router/model-map.constant';
import { ChatCompletionRequestDto } from '../../modules/gateway/dto/chat-completion-request.dto';

/**
 * Fast-path provider inference — mirrors RouterService steps 3 and 4 without
 * any DB call. Used by the guard to identify which provider config to read for
 * rate-limit thresholds.
 */
function inferProviderFromModel(model: string): string {
  const exact = MODEL_PROVIDER_MAP[model];
  if (exact) return exact;
  for (const entry of MODEL_PREFIX_MAP) {
    if (model.startsWith(entry.prefix)) return entry.provider;
  }
  return 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly providerConfigsRepo: ProviderConfigsRepository,
    private readonly adapterRegistry: AdapterRegistry,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // ── a. Require tenant set by AuthGuard ────────────────────────────────────
    const tenant = req.tenant as AuthContext | undefined;
    if (!tenant) {
      // Developer error: RateLimitGuard applied without AuthGuard preceding it.
      throw new InternalServerErrorException(
        'RateLimitGuard requires AuthGuard to run first (req.tenant is missing)',
      );
    }

    // ── b. Identify provider from header or model inference ───────────────────
    const body = req.body as ChatCompletionRequestDto;
    const provider =
      (req.headers['x-provider'] as string | undefined) ??
      inferProviderFromModel(body.model);

    // ── c. Load provider config — skip rate limiting if none configured ────────
    const config = await this.providerConfigsRepo.findByTenantAndProvider(
      tenant.tenantId,
      provider,
    );
    if (!config) {
      this.logger.debug(
        `No provider config for ${tenant.tenantId}/${provider} — skipping rate limit`,
      );
      return true;
    }

    // ── d. Estimate tokens (CPU-only — no Redis, before any Redis call) ──────────
    // Pure arithmetic. Running this first ensures no Redis slot is consumed for
    // a request that would have been rejected by TPM anyway (avoids phantom RPM
    // decrements against a TPM-limited window).
    let estimatedTokens: number | undefined;
    if (this.adapterRegistry.has(provider)) {
      estimatedTokens = this.adapterRegistry
        .get(provider)
        .estimateTokens(body.messages);
    }

    // ── e. RPM check (first Redis call — increments counter) ──────────────────
    const rpmResult = await this.rateLimitService.checkRpm(
      tenant.tenantId,
      provider,
      config.rateLimitRpm,
    );
    if (!rpmResult.allowed) {
      throw new HttpException(
        {
          error: 'rate_limit_exceeded',
          message: 'Request rate limit exceeded',
          request_id: req.requestId,
          retry_after_ms: rpmResult.retryAfterMs,
          limit_type: 'rpm',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── e.5 Budget check (read-only Redis GET — no state mutation) ───────────
    // Placed after RPM (so the RPM slot is consumed by the attempt) but before
    // TPM (so we don't add token weight for a request we're about to reject).
    const budgetExceeded = await this.redis.get(
      `tenant:${tenant.tenantId}:budget:exceeded`,
    );
    if (budgetExceeded) {
      throw new HttpException(
        {
          error: 'budget_exceeded',
          message: 'Monthly budget limit reached',
          request_id: req.requestId,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // ── f. TPM check (second Redis call — uses pre-computed token estimate) ────
    if (estimatedTokens !== undefined) {
      const tpmResult = await this.rateLimitService.checkTpm(
        tenant.tenantId,
        provider,
        estimatedTokens,
        config.rateLimitTpm,
      );
      if (!tpmResult.allowed) {
        throw new HttpException(
          {
            error: 'rate_limit_exceeded',
            message: 'Token rate limit exceeded',
            request_id: req.requestId,
            retry_after_ms: tpmResult.retryAfterMs,
            limit_type: 'tpm',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // ── g. Attach RPM result for downstream header injection ───────────────────
    req.rateLimit = rpmResult;

    return true;
  }
}
