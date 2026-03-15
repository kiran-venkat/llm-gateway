import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CacheService, CachedResponse } from '../../cache/cache.service';

export interface CacheJobData {
  cacheKey: string;
  tenantId: string;
  provider: string;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  ttlSeconds: number;
}

@Processor('cache')
export class CacheJob {
  private readonly logger = new Logger(CacheJob.name);

  constructor(private readonly cacheService: CacheService) {}

  @Process('cache-response')
  async handle(job: Job<CacheJobData>): Promise<void> {
    const d = job.data;

    const cached: CachedResponse = {
      content: d.content,
      model: d.model,
      provider: d.provider,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      cachedAt: new Date().toISOString(),
    };

    try {
      await this.cacheService.set(d.cacheKey, cached, d.ttlSeconds);
      this.logger.log(
        `Cached response key=${d.cacheKey} tenant=${d.tenantId} ttl=${d.ttlSeconds}s`,
      );
    } catch (err: unknown) {
      // CacheService.set() never throws — this catch is a final safety net
      this.logger.error(
        `CacheJob failed for key=${d.cacheKey} tenant=${d.tenantId}`,
        err,
      );
    }
  }
}
