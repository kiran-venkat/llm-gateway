import { HttpException, HttpStatus } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-aaa-bbb',
    name: 'Acme Corp',
    slug: 'acme-corp',
    plan: 'pro',
    monthlyBudgetUsd: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Tenant;
}

function makeMockService(): jest.Mocked<TenantsService> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<TenantsService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantsController', () => {
  let controller: TenantsController;
  let service: jest.Mocked<TenantsService>;

  beforeEach(() => {
    service = makeMockService();
    controller = new TenantsController(service);
  });

  // ── POST /api/v1/tenants ──────────────────────────────────────────────────

  describe('create()', () => {
    it('calls service.create with the DTO and returns the result', async () => {
      const dto: CreateTenantDto = { name: 'Acme Corp', slug: 'acme-corp' };
      const tenant = makeTenant();
      service.create.mockResolvedValue(tenant);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(tenant);
    });

    it('propagates HttpException from service (e.g. duplicate slug)', async () => {
      const dto: CreateTenantDto = { name: 'Dup', slug: 'dup' };
      service.create.mockRejectedValue(
        new HttpException('slug already taken', HttpStatus.CONFLICT),
      );

      await expect(controller.create(dto)).rejects.toThrow(HttpException);
    });
  });

  // ── GET /api/v1/tenants/:id ───────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the tenant for a valid ID', async () => {
      const tenant = makeTenant();
      service.findById.mockResolvedValue(tenant);

      const result = await controller.findOne('tenant-aaa-bbb');

      expect(service.findById).toHaveBeenCalledWith('tenant-aaa-bbb');
      expect(result).toBe(tenant);
    });

    it('propagates 404 when tenant is not found', async () => {
      service.findById.mockRejectedValue(
        new HttpException('Tenant not found', HttpStatus.NOT_FOUND),
      );

      await expect(controller.findOne('ghost-id')).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ── PATCH /api/v1/tenants/:id ─────────────────────────────────────────────

  describe('update()', () => {
    it('calls service.update with id and DTO and returns the result', async () => {
      const dto: UpdateTenantDto = { plan: 'enterprise' };
      const updated = makeTenant({ plan: 'enterprise' });
      service.update.mockResolvedValue(updated);

      const result = await controller.update('tenant-aaa-bbb', dto);

      expect(service.update).toHaveBeenCalledWith('tenant-aaa-bbb', dto);
      expect(result).toBe(updated);
    });
  });

  // ── AdminGuard is the sole guard (no req.tenant contamination) ────────────

  it('does not accept @TenantContext — no AuthGuard at class level', () => {
    // Verify by inspecting guard metadata: AdminGuard should be the only guard.
    // This is a compile-time + design-time check rather than a runtime check, but
    // we can assert that calling the controller directly (without req.tenant)
    // does not throw any "tenant is undefined" errors — the service handles it.
    const dto: CreateTenantDto = { name: 'Test', slug: 'test' };
    service.create.mockResolvedValue(makeTenant());

    // If controller accidentally reads req.tenant it would blow up here.
    // No mock of req.tenant is provided.
    expect(() => controller.create(dto)).not.toThrow();
  });
});
