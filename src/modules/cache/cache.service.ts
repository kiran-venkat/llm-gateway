import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

export interface CachedResponse {
  content: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedAt: string; // ISO timestamp
}

export interface CacheTopEntry {
  hash: string;       // first 16 chars of requestHash
  hit_count: number;
  cost_saved: number;
}

export interface CacheStats {
  total_hits: number;
  hit_rate: number;         // 0-1 (e.g. 0.6 for 60%)
  cost_saved_usd: number;
  top_entries: CacheTopEntry[];
}

// Conservative average across providers: $0.002 per 1K tokens
const COST_PER_1K_TOKENS = 0.002;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

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

  async upsertEntry(params: {
    tenantId: string;
    requestHash: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    ttlSeconds: number;
  }): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
      await this.prisma.cacheEntry.upsert({
        where: {
          tenantId_requestHash: {
            tenantId: params.tenantId,
            requestHash: params.requestHash,
          },
        },
        create: {
          tenantId: params.tenantId,
          requestHash: params.requestHash,
          provider: params.provider,
          model: params.model,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          ttlSeconds: params.ttlSeconds,
          expiresAt,
        },
        update: {
          provider: params.provider,
          model: params.model,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          ttlSeconds: params.ttlSeconds,
          expiresAt,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Cache upsertEntry failed for hash=${params.requestHash}`,
        err,
      );
    }
  }

  async recordHit(
    tenantId: string,
    requestHash: string,
    tokensSaved: number,
  ): Promise<void> {
    try {
      const costIncrement = (tokensSaved / 1000) * COST_PER_1K_TOKENS;
      await this.prisma.cacheEntry.update({
        where: { tenantId_requestHash: { tenantId, requestHash } },
        data: {
          hitCount: { increment: 1 },
          lastHitAt: new Date(),
          costSavedUsd: { increment: costIncrement },
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Cache recordHit failed for hash=${requestHash}`,
        err,
      );
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
      const hit_rate = total > 0 ? hits / total : 0;
      const cost_saved_usd = (tokensSaved / 1000) * COST_PER_1K_TOKENS;

      const entries = await this.prisma.cacheEntry.findMany({
        where: { tenantId },
        orderBy: { hitCount: 'desc' },
        take: 10,
        select: { requestHash: true, hitCount: true, costSavedUsd: true },
      });

      const top_entries: CacheTopEntry[] = entries.map((e) => ({
        hash: e.requestHash.slice(0, 16),
        hit_count: e.hitCount,
        cost_saved: Number(e.costSavedUsd),
      }));

      return { total_hits: hits, hit_rate, cost_saved_usd, top_entries };
    } catch (err: unknown) {
      this.logger.warn('Cache stats GET failed', err);
      return { total_hits: 0, hit_rate: 0, cost_saved_usd: 0, top_entries: [] };
    }
  }
}
