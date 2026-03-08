import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaDelegate } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Repository for the `tenants` table.
 *
 * Why this does NOT extend BaseRepository<Tenant>:
 * The `Tenant` model is the root of the multi-tenant hierarchy — it IS the tenant
 * scope. It has no `tenantId` FK column pointing to another table. BaseRepository
 * injects `{ tenantId }` into every Prisma `where` clause, which would cause a
 * Prisma runtime error on the `tenants` table because `tenantId` is not a valid
 * field on that model.
 *
 * We still use the same PrismaDelegate pattern (same interface, same safe cast)
 * to keep the approach consistent across all repositories.
 */
@Injectable()
export class TenantsRepository {
  private readonly delegate: PrismaDelegate<Tenant>;

  constructor(prisma: PrismaService) {
    this.delegate = prisma.tenant as unknown as PrismaDelegate<Tenant>;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.delegate.findFirst({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.delegate.findFirst({ where: { slug } });
  }

  async create(data: Record<string, unknown>): Promise<Tenant> {
    return this.delegate.create({ data });
  }

  async update(id: string, data: Record<string, unknown>): Promise<Tenant> {
    return this.delegate.update({ where: { id }, data });
  }
}
