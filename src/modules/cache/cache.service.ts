import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

export interface CachedResponse {
  content: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedAt: string; // ISO timestamp
}

export interface CacheStats {
  hits: number;
  misses: number;
  total: number;
  hitRatePct: number;
  tokensSaved: number;
  estimatedCostSavedUsd: number;
}

// Conservative average across providers: $0.002 per 1K tokens
const COST_PER_1K_TOKENS = 0.002;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async get(key: string): Promise<CachedResponse | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedResponse;
    } catch (err: unknown) {
      this.logger.warn(`Cache GET failed for key ${key}`, err);
      return null;
    }
  }

  async set(
    key: string,
    value: CachedResponse,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: unknown) {
      this.logger.warn(`Cache SET failed for key ${key}`, err);
    }
  }

  async incrementHit(tenantId: string, tokensSaved: number): Promise<void> {
    const base = `tenant:${tenantId}:cache:stats`;
    try {
      await Promise.all([
        this.redis.incr(`${base}:hits`),
        this.redis.incrby(`${base}:tokens_saved`, tokensSaved),
      ]);
    } catch (err: unknown) {
      this.logger.warn('Cache stats increment (hit) failed', err);
    }
  }

  async incrementMiss(tenantId: string): Promise<void> {
    try {
      await this.redis.incr(`tenant:${tenantId}:cache:stats:misses`);
    } catch (err: unknown) {
      this.logger.warn('Cache stats increment (miss) failed', err);
    }
  }

  async getStats(tenantId: string): Promise<CacheStats> {
    const base = `tenant:${tenantId}:cache:stats`;
    try {
      const [hitsRaw, missesRaw, savedRaw] = await Promise.all([
        this.redis.get(`${base}:hits`),
        this.redis.get(`${base}:misses`),
        this.redis.get(`${base}:tokens_saved`),
      ]);
      const hits = parseInt(hitsRaw ?? '0', 10);
      const misses = parseInt(missesRaw ?? '0', 10);
      const tokensSaved = parseInt(savedRaw ?? '0', 10);
      const total = hits + misses;
      return {
        hits,
        misses,
        total,
        hitRatePct: total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
        tokensSaved,
        estimatedCostSavedUsd:
          Math.round((tokensSaved / 1000) * COST_PER_1K_TOKENS * 10000) /
          10000,
      };
    } catch (err: unknown) {
      this.logger.warn('Cache stats GET failed', err);
      return {
        hits: 0,
        misses: 0,
        total: 0,
        hitRatePct: 0,
        tokensSaved: 0,
        estimatedCostSavedUsd: 0,
      };
    }
  }
}
