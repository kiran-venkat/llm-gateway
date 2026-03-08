import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsRepository } from './tenants.repository';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

@Injectable()
export class TenantsService {
  constructor(private readonly repo: TenantsRepository) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    if (!SLUG_PATTERN.test(dto.slug)) {
      throw new HttpException(
        'slug must contain only lowercase letters, numbers, and hyphens',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.repo.create({
      name: dto.name,
      slug: dto.slug,
      plan: dto.plan ?? 'free',
      ...(dto.monthly_budget_usd !== undefined && {
        monthlyBudgetUsd: dto.monthly_budget_usd,
      }),
    });
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.repo.findById(id);
    if (!tenant) {
      throw new HttpException(
        `Tenant with id '${id}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    // Verify existence first so callers get a 404, not a Prisma P2025 error.
    await this.findById(id);

    if (dto.slug !== undefined && !SLUG_PATTERN.test(dto.slug)) {
      throw new HttpException(
        'slug must contain only lowercase letters, numbers, and hyphens',
        HttpStatus.BAD_REQUEST,
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.slug !== undefined) data['slug'] = dto.slug;
    if (dto.plan !== undefined) data['plan'] = dto.plan;
    if (dto.monthly_budget_usd !== undefined) {
      data['monthlyBudgetUsd'] = dto.monthly_budget_usd;
    }

    return this.repo.update(id, data);
  }
}
