import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ProviderConfig } from '@prisma/client';
import {
  BaseRepository,
  PrismaDelegate,
} from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { decrypt } from '../../common/utils/encryption.util';

@Injectable()
export class ProviderConfigsRepository extends BaseRepository<ProviderConfig> {
  constructor(
    prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {
    super(prisma.providerConfig as unknown as PrismaDelegate<ProviderConfig>);
  }

  async findByTenantAndProvider(
    tenantId: string,
    provider: string,
  ): Promise<ProviderConfig | null> {
    this.guardTenantId(tenantId, 'findByTenantAndProvider');
    return this.delegate.findFirst({ where: { tenantId, provider } });
  }

  async findActiveByTenant(tenantId: string): Promise<ProviderConfig[]> {
    this.guardTenantId(tenantId, 'findActiveByTenant');
    return this.delegate.findMany({ where: { tenantId, isActive: true } });
  }

  /**
   * Fetch the provider config and return the decrypted API key.
   * Throws 404 if no active config exists for this tenant + provider.
   * Used by adapters on every request — config is assumed to be cached
   * at the HTTP layer so this is not on the hot path.
   */
  async getDecryptedApiKey(tenantId: string, provider: string): Promise<string> {
    const cfg = await this.findByTenantAndProvider(tenantId, provider);
    if (!cfg) {
      throw new HttpException(
        `No provider config found for '${provider}'`,
        HttpStatus.NOT_FOUND,
      );
    }
    const key = this.config.getEncryptionKey();
    return decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, key);
  }
}
