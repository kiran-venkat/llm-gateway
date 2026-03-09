import { Injectable } from '@nestjs/common';
import { RoutingRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * RouterRepository does NOT extend BaseRepository.
 *
 * Routing rules have two kinds of tenant_id:
 *   - A UUID string → tenant-specific rule
 *   - NULL          → global rule applied to all tenants
 *
 * BaseRepository injects `WHERE tenant_id = $1` into every query, which would
 * exclude global rules. We need a mixed OR query:
 *   WHERE (tenant_id = $tenantId OR tenant_id IS NULL) AND is_active = true
 *
 * Prisma cannot express IS NULL through the Record<string,unknown> pattern used
 * by our PrismaDelegate interface, so we call the Prisma client directly.
 */
@Injectable()
export class RouterRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns tenant-specific rules + global rules (tenant_id IS NULL),
   * both filtered to is_active = true, ordered by priority ASC (lower = higher priority).
   */
  async findRulesForTenant(tenantId: string): Promise<RoutingRule[]> {
    return this.prisma.routingRule.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null }],
        isActive: true,
      },
      orderBy: { priority: 'asc' },
    });
  }
}
