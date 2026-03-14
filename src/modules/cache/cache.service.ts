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
}
