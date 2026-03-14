import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { ProviderConfig } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { AppConfigService } from '../../config/config.service';
import { decrypt } from '../../common/utils/encryption.util';

const PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_S = 30;
const DEGRADED_THRESHOLD_MS = 3_000;

export interface ProviderStatus {
  provider: string;
  status: 'active' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
}

export interface StatusResponse {
  providers: ProviderStatus[];
  cached: boolean;
  checkedAt: string;
}

interface CachedPayload {
  providers: ProviderStatus[];
  checkedAt: string;
}

@Injectable()
export class ProviderStatusService {
  private readonly logger = new Logger(ProviderStatusService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly providerConfigsRepo: ProviderConfigsRepository,
    private readonly configService: AppConfigService,
  ) {}

  async getStatus(tenantId: string): Promise<StatusResponse> {
    const cacheKey = `tenant:${tenantId}:providers:status`;

    // ── Cache hit ──────────────────────────────────────────────────────────
    const hit = await this.redis.get(cacheKey);
    if (hit) {
      const payload = JSON.parse(hit) as CachedPayload;
      return { ...payload, cached: true };
    }

    // ── Cache miss — run probes in parallel ────────────────────────────────
    const configs = await this.providerConfigsRepo.findActiveByTenant(tenantId);
    const encKey = this.configService.getEncryptionKey();

    const results = await Promise.allSettled(
      configs.map((config) => this.checkProvider(config, encKey)),
    );

    // Map results; use configs[i].provider in the rejection fallback so the
    // provider name is always accurate even when checkProvider itself throws.
    const providers: ProviderStatus[] = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            provider: configs[i].provider,
            status: 'down' as const,
            latencyMs: 0,
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          },
    );

    const checkedAt = new Date().toISOString();

    // Persist without the `cached` flag — that field is added at read time.
    const payload: CachedPayload = { providers, checkedAt };
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_S);

    return { providers, cached: false, checkedAt };
  }

  // ---------------------------------------------------------------------------
  // Public — exposed for jest.spyOn in tests (no module-level mock needed)
  // ---------------------------------------------------------------------------

  public async checkProvider(
    config: ProviderConfig,
    encKey: Buffer,
  ): Promise<ProviderStatus> {
    const apiKey = decrypt(config.apiKeyEncrypted, config.apiKeyIv, encKey);
    const start = Date.now();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${PROBE_TIMEOUT_MS}ms`)),
        PROBE_TIMEOUT_MS,
      ),
    );

    try {
      await Promise.race([this.probe(config.provider, apiKey), timeout]);
      const latencyMs = Date.now() - start;
      return {
        provider: config.provider,
        status: latencyMs < DEGRADED_THRESHOLD_MS ? 'active' : 'degraded',
        latencyMs,
      };
    } catch (err) {
      this.logger.warn(
        `Provider probe failed for ${config.provider}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        provider: config.provider,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async probe(provider: string, apiKey: string): Promise<void> {
    switch (provider) {
      case 'openai':
        return this.probeOpenAI(apiKey);
      case 'anthropic':
        return this.probeAnthropic(apiKey);
      case 'gemini':
        return this.probeGemini(apiKey);
      default:
        throw new Error(`No probe defined for provider: ${provider}`);
    }
  }

  public async probeOpenAI(apiKey: string): Promise<void> {
    const client = new OpenAI({ apiKey });
    await client.models.list();
  }

  public async probeAnthropic(apiKey: string): Promise<void> {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    });
  }

  public async probeGemini(apiKey: string): Promise<void> {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    await model.generateContent('ok');
  }
}
