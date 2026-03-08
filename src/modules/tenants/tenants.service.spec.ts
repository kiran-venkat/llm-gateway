import { HttpException, HttpStatus } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsRepository } from './tenants.repository';
import { TenantsService } from './tenants.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme-corp',
    plan: 'free',
    monthlyBudgetUsd: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockRepo(): jest.Mocked<TenantsRepository> {
  return {
    findById: jest.fn(),
    findBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<TenantsRepository>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantsService', () => {
  let service: TenantsService;
  let repo: jest.Mocked<TenantsRepository>;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new TenantsService(repo);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const VALID_DTO: CreateTenantDto = {
      name: 'Acme Corp',
      slug: 'acme-corp',
    };

    it('creates a tenant and returns the record', async () => {
      repo.create.mockResolvedValue(makeTenant());
      const result = await service.create(VALID_DTO);
      expect(result.slug).toBe('acme-corp');
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('passes name, slug, and default plan to repository', async () => {
      repo.create.mockResolvedValue(makeTenant());
      await service.create(VALID_DTO);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme Corp',
          slug: 'acme-corp',
          plan: 'free',
        }),
      );
    });

    it('passes monthly_budget_usd as monthlyBudgetUsd when provided', async () => {
      repo.create.mockResolvedValue(makeTenant());
      await service.create({ ...VALID_DTO, monthly_budget_usd: 100 });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ monthlyBudgetUsd: 100 }),
      );
    });

    it('omits monthlyBudgetUsd when monthly_budget_usd is not provided', async () => {
      repo.create.mockResolvedValue(makeTenant());
      await service.create(VALID_DTO);
      const callArg = repo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('monthlyBudgetUsd');
    });

    describe('slug validation', () => {
      it.each([
        'Has Uppercase',
        'has spaces',
        'has_underscore',
        'has.dot',
        'has@symbol',
        '',
      ])('throws 400 for invalid slug %j', async (badSlug) => {
        await expect(
          service.create({ ...VALID_DTO, slug: badSlug }),
        ).rejects.toThrow(HttpException);

        await expect(
          service.create({ ...VALID_DTO, slug: badSlug }),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      });

      it.each(['acme', 'acme-corp', 'my-org-123', '123abc', 'a-b-c'])(
        'accepts valid slug %j',
        async (goodSlug) => {
          repo.create.mockResolvedValue(makeTenant({ slug: goodSlug }));
          await expect(
            service.create({ ...VALID_DTO, slug: goodSlug }),
          ).resolves.toBeDefined();
        },
      );

      it('does not call repository when slug is invalid', async () => {
        await expect(
          service.create({ ...VALID_DTO, slug: 'INVALID SLUG' }),
        ).rejects.toThrow();
        expect(repo.create).not.toHaveBeenCalled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('returns the tenant when it exists', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      const result = await service.findById(TENANT_ID);
      expect(result.id).toBe(TENANT_ID);
    });

    it('throws 404 when the tenant does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById('nonexistent-id')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws HttpException (not a generic Error) on 404', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toBeInstanceOf(HttpException);
    });

    it('includes the id in the 404 message', async () => {
      repo.findById.mockResolvedValue(null);
      let message = '';
      try {
        await service.findById('missing-id');
      } catch (e) {
        if (e instanceof HttpException) {
          message = String(e.message);
        }
      }
      expect(message).toContain('missing-id');
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    const UPDATED: Tenant = makeTenant({
      name: 'Acme Renamed',
      slug: 'acme-renamed',
    });

    it('calls repository update with only the provided fields', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(UPDATED);

      await service.update(TENANT_ID, {
        name: 'Acme Renamed',
        slug: 'acme-renamed',
      });

      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ name: 'Acme Renamed', slug: 'acme-renamed' }),
      );
    });

    it('returns the updated record', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(UPDATED);
      const result = await service.update(TENANT_ID, { name: 'Acme Renamed' });
      expect(result.name).toBe('Acme Renamed');
    });

    it('throws 404 when the tenant does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update('nonexistent', { name: 'x' }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('does not call repository update when tenant does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update('x', { name: 'y' })).rejects.toThrow();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws 400 when updated slug is invalid', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      await expect(
        service.update(TENANT_ID, { slug: 'INVALID SLUG' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('maps monthly_budget_usd to monthlyBudgetUsd in the repository call', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(UPDATED);
      await service.update(TENANT_ID, { monthly_budget_usd: 500 });
      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ monthlyBudgetUsd: 500 }),
      );
    });

    it('does not include undefined fields in the update payload', async () => {
      repo.findById.mockResolvedValue(makeTenant());
      repo.update.mockResolvedValue(UPDATED);

      const dto: UpdateTenantDto = { name: 'Only Name' };
      await service.update(TENANT_ID, dto);

      const callArg = repo.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('slug');
      expect(callArg).not.toHaveProperty('plan');
      expect(callArg).not.toHaveProperty('monthlyBudgetUsd');
    });
  });
});
