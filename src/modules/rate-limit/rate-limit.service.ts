import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RateLimitResult } from '../../common/interfaces/rate-limit-result.interface';

const RPM_WINDOW_MS = 60_000;

@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);
  private luaScript!: string;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  onModuleInit(): void {
    this.luaScript = readFileSync(
      join(__dirname, 'sliding-window.lua'),
      'utf8',
    );
    this.logger.log('Sliding-window Lua script loaded');
  }

  /**
   * Atomic RPM check + increment via Lua sliding window.
   *
   * Redis key: ratelimit:{tenantId}:{provider}:rpm
   * Window:    60 000 ms
   */
  async checkRpm(
    tenantId: string,
    provider: string,
    limit: number,
  ): Promise<RateLimitResult> {
    return this.runScript(tenantId, provider, 'rpm', RPM_WINDOW_MS, limit);
  }

  /**
   * TPM pre-check.
   *
   * V1: treated as RPM with a higher limit threshold — one entry per request
   * regardless of token count.  True token-weighted tracking (ZADD with score =
   * token count, ZRANGEBYSCORE sum) is deferred to V2.
   *
   * Redis key: ratelimit:{tenantId}:{provider}:tpm
   */
  async checkTpm(
    tenantId: string,
    provider: string,
    _estimatedTokens: number,
    limit: number,
  ): Promise<RateLimitResult> {
    return this.runScript(tenantId, provider, 'tpm', RPM_WINDOW_MS, limit);
  }

  /**
   * Read-only count for response headers — does NOT register a request.
   *
   * Cleans stale entries then returns how many slots remain.
   * Called after checkRpm succeeds so headers reflect the post-increment state.
   */
  async getRemainingRpm(
    tenantId: string,
    provider: string,
    limit: number,
  ): Promise<number> {
    const key = this.buildKey(tenantId, provider, 'rpm');
    const now = Date.now();
    await this.redis.zremrangebyscore(key, 0, now - RPM_WINDOW_MS);
    const count = await this.redis.zcard(key);
    return Math.max(0, limit - count);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async runScript(
    tenantId: string,
    provider: string,
    type: 'rpm' | 'tpm',
    windowMs: number,
    limit: number,
  ): Promise<RateLimitResult> {
    const key = this.buildKey(tenantId, provider, type);
    const now = Date.now();
    const member = `${now}-${Math.random()}`;
    const resetAt = new Date(now + windowMs);

    const result = (await this.redis.eval(
      this.luaScript,
      1, // numkeys
      key, // KEYS[1]
      String(now), // ARGV[1]
      String(windowMs), // ARGV[2]
      String(limit), // ARGV[3]
      member, // ARGV[4]
    )) as [number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];

    return {
      allowed,
      remaining,
      resetAt,
      ...(allowed ? {} : { retryAfterMs: windowMs }),
      limitType: type,
    };
  }

  private buildKey(
    tenantId: string,
    provider: string,
    type: 'rpm' | 'tpm',
  ): string {
    return `ratelimit:${tenantId}:${provider}:${type}`;
  }
}
