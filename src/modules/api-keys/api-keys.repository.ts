import { Injectable } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import {
  BaseRepository,
  PrismaDelegate,
} from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeysRepository extends BaseRepository<ApiKey> {
  constructor(prisma: PrismaService) {
    super(prisma.apiKey as unknown as PrismaDelegate<ApiKey>);
  }

  /**
   * Lookup by SHA-256 hash of the raw bearer token.
   *
   * This is the ONE legitimate exception to the tenantId-first rule:
   * during auth we only have the raw key — we don't yet know which
   * tenant it belongs to. The hash is globally unique across all
   * tenants, so no tenantId scoping is needed or correct here.
   */
  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.delegate.findFirst({ where: { keyHash } });
  }

  async findActiveByTenant(tenantId: string): Promise<ApiKey[]> {
    this.guardTenantId(tenantId, 'findActiveByTenant');
    return this.delegate.findMany({ where: { tenantId, isActive: true } });
  }
}
