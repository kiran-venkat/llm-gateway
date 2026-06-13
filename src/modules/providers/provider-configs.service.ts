import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ProviderConfig } from '@prisma/client';
import { AppConfigService } from '../../config/config.service';
import { encrypt } from '../../common/utils/encryption.util';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto';
import {
  ProviderConfigListItemDto,
  ProviderConfigResponseDto,
} from './dto/provider-config-response.dto';

@Injectable()
export class ProviderConfigsService {
  constructor(
    private readonly repo: ProviderConfigsRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Create or update a provider config for this tenant.
   * The api_key is encrypted before storage — never persisted in plaintext.
   * Re-activates a previously soft-deleted config if one exists.
   */
  async upsert(
    tenantId: string,
    dto: UpsertProviderConfigDto,
  ): Promise<ProviderConfigResponseDto> {
    const encKey = this.config.getEncryptionKey();
    const { ciphertext, iv } = encrypt(dto.api_key, encKey);

    const existing = await this.repo.findByTenantAndProvider(
      tenantId,
      dto.provider,
    );

    if (existing) {
      const updated = await this.repo.update(tenantId, existing.id, {
        apiKeyEncrypted: ciphertext,
        apiKeyIv: iv,
        isActive: true,
        ...(dto.rate_limit_rpm !== undefined && {
          rateLimitRpm: dto.rate_limit_rpm,
        }),
        ...(dto.rate_limit_tpm !== undefined && {
          rateLimitTpm: dto.rate_limit_tpm,
        }),
        ...(dto.monthly_spend_limit_usd !== undefined && {
          monthlySpendLimitUsd: dto.monthly_spend_limit_usd,
        }),
      });
      return this.toResponseDto(updated);
    }

    const created = await this.repo.create(tenantId, {
      provider: dto.provider,
      apiKeyEncrypted: ciphertext,
      apiKeyIv: iv,
      isActive: true,
      rateLimitRpm: dto.rate_limit_rpm ?? 60,
      rateLimitTpm: dto.rate_limit_tpm ?? 100000,
      ...(dto.monthly_spend_limit_usd !== undefined && {
        monthlySpendLimitUsd: dto.monthly_spend_limit_usd,
      }),
    });
    return this.toResponseDto(created);
  }

  /** Returns all active configs for the tenant. API key masked as '****'. */
  async list(tenantId: string): Promise<ProviderConfigListItemDto[]> {
    const configs = await this.repo.findActiveByTenant(tenantId);
    return configs.map((c) => ({ ...this.toResponseDto(c), api_key: '****' }));
  }

  /** Soft-delete: sets is_active = false. Hard deletes are not supported. */
  async remove(tenantId: string, provider: string): Promise<void> {
    const existing = await this.repo.findByTenantAndProvider(
      tenantId,
      provider,
    );
    if (!existing) {
      throw new HttpException(
        `No provider config found for '${provider}'`,
        HttpStatus.NOT_FOUND,
      );
    }
    await this.repo.update(tenantId, existing.id, { isActive: false });
  }

  private toResponseDto(cfg: ProviderConfig): ProviderConfigResponseDto {
    return {
      id: cfg.id,
      provider: cfg.provider,
      is_active: cfg.isActive,
      rate_limit_rpm: cfg.rateLimitRpm,
      rate_limit_tpm: cfg.rateLimitTpm,
      monthly_spend_limit_usd:
        cfg.monthlySpendLimitUsd != null
          ? Number(cfg.monthlySpendLimitUsd)
          : null,
      created_at: cfg.createdAt,
      updated_at: cfg.updatedAt,
    };
  }
}
