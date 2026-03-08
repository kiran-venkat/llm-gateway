import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { hashApiKey } from '../../common/utils/hash.util';
import { ApiKeysRepository } from './api-keys.repository';
import {
  ApiKeyListItemDto,
  ApiKeyResponseDto,
} from './dto/api-key-response.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly repo: ApiKeysRepository) {}

  /**
   * Generates a new API key for the tenant.
   *
   * The raw key is derived from cryptographically secure random bytes and is
   * returned exactly once in the response. Only the SHA-256 hash is persisted.
   * After this method returns, the raw key is gone — there is no recovery path.
   */
  async generate(
    tenantId: string,
    dto: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    const rawKey = 'lgk_' + randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const record = await this.repo.create(tenantId, {
      keyHash,
      keyPrefix,
      name: dto.name ?? null,
      isActive: true,
      ...(dto.expires_at !== undefined && {
        expiresAt: new Date(dto.expires_at),
      }),
    });

    return {
      id: record.id,
      key: rawKey,
      key_prefix: record.keyPrefix,
      name: record.name ?? null,
      created_at: record.createdAt,
    };
  }

  /**
   * Soft-deletes an API key by setting isActive = false.
   *
   * The record is kept for audit. Verifies the key belongs to the requesting
   * tenant before revoking — cross-tenant revocation is rejected with 404
   * (not 403, to avoid confirming the key exists for another tenant).
   */
  async revoke(tenantId: string, id: string): Promise<void> {
    const key = await this.repo.findById(tenantId, id);
    if (!key) {
      throw new HttpException(
        `API key '${id}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    await this.repo.update(tenantId, id, { isActive: false });
  }

  /**
   * Returns all active and inactive keys for the tenant.
   * The raw key and keyHash are never included in the list response.
   */
  async listForTenant(tenantId: string): Promise<ApiKeyListItemDto[]> {
    const keys = await this.repo.findMany(tenantId);
    return keys.map((k) => ({
      id: k.id,
      key_prefix: k.keyPrefix,
      name: k.name ?? null,
      is_active: k.isActive,
      last_used_at: k.lastUsedAt,
      expires_at: k.expiresAt,
      created_at: k.createdAt,
    }));
  }
}
