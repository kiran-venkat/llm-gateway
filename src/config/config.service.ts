import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

type NodeEnv = 'development' | 'production' | 'test';

/**
 * Typed wrapper around NestJS ConfigService.
 *
 * All environment access goes through these getters — no raw string keys
 * scattered across the codebase. Because the Joi schema has already validated
 * every value at startup, the non-null assertions here are safe.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService) {}

  getNodeEnv(): NodeEnv {
    return this.config.get<NodeEnv>('NODE_ENV') as NodeEnv;
  }

  getPort(): number {
    return this.config.get<number>('PORT', { infer: true }) as number;
  }

  getDatabaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  getRedisUrl(): string {
    return this.config.getOrThrow<string>('REDIS_URL');
  }

  /**
   * Returns the encryption key as a 32-byte Buffer ready for AES-256-GCM use.
   * The hex string is validated to be exactly 64 chars by the Joi schema,
   * so Buffer.from(..., 'hex') will always produce exactly 32 bytes here.
   */
  getEncryptionKey(): Buffer {
    const hex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    return Buffer.from(hex, 'hex');
  }

  getAdminSecret(): string {
    return this.config.getOrThrow<string>('ADMIN_SECRET');
  }
}
