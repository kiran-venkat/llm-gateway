import {
  BaseRepository,
  MissingTenantIdError,
  PrismaDelegate,
} from './base.repository';

// ---------------------------------------------------------------------------
// Test fixture types
// ---------------------------------------------------------------------------

type TestModel = { id: string; tenantId: string; name: string };

// Concrete subclass — BaseRepository is abstract so we need something to instantiate.
class TestRepository extends BaseRepository<TestModel> {
  constructor(delegate: PrismaDelegate<TestModel>) {
    super(delegate);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-abc-123';
const ID = 'record-xyz-456';
const RECORD: TestModel = { id: ID, tenantId: TENANT, name: 'hello' };

function makeMockDelegate(): jest.Mocked<PrismaDelegate<TestModel>> {
  return {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseRepository', () => {
  let delegate: jest.Mocked<PrismaDelegate<TestModel>>;
  let repo: TestRepository;

  beforeEach(() => {
    delegate = makeMockDelegate();
    repo = new TestRepository(delegate);
  });

  // -------------------------------------------------------------------------
  // Tenant guard — every method must reject a missing / blank tenantId
  // -------------------------------------------------------------------------

  describe('tenant isolation guard', () => {
    const INVALID_TENANT_IDS = ['', '   ', '\t', '\n'];

    describe('findById', () => {
      it.each(INVALID_TENANT_IDS)(
        'throws MissingTenantIdError for tenantId %j',
        async (bad) => {
          await expect(repo.findById(bad, ID)).rejects.toThrow(
            MissingTenantIdError,
          );
        },
      );

      it('never calls the delegate when tenantId is invalid', async () => {
        await expect(repo.findById('', ID)).rejects.toThrow();
        expect(delegate.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('findMany', () => {
      it.each(INVALID_TENANT_IDS)(
        'throws MissingTenantIdError for tenantId %j',
        async (bad) => {
          await expect(repo.findMany(bad)).rejects.toThrow(
            MissingTenantIdError,
          );
        },
      );
    });

    describe('create', () => {
      it.each(INVALID_TENANT_IDS)(
        'throws MissingTenantIdError for tenantId %j',
        async (bad) => {
          await expect(repo.create(bad, { name: 'x' })).rejects.toThrow(
            MissingTenantIdError,
          );
        },
      );
    });

    describe('update', () => {
      it.each(INVALID_TENANT_IDS)(
        'throws MissingTenantIdError for tenantId %j',
        async (bad) => {
          await expect(repo.update(bad, ID, { name: 'x' })).rejects.toThrow(
            MissingTenantIdError,
          );
        },
      );
    });

    describe('delete', () => {
      it.each(INVALID_TENANT_IDS)(
        'throws MissingTenantIdError for tenantId %j',
        async (bad) => {
          await expect(repo.delete(bad, ID)).rejects.toThrow(
            MissingTenantIdError,
          );
        },
      );
    });

    it('error carries the operation name in the message', async () => {
      let caught: unknown;
      try {
        await repo.findById('', ID);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(MissingTenantIdError);
      const err = caught as MissingTenantIdError;
      expect(err.message).toContain('findById');
      expect(err.code).toBe('MISSING_TENANT_ID');
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — tenantId is always injected into the delegate call
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('calls delegate.findFirst with id and tenantId in where clause', async () => {
      delegate.findFirst.mockResolvedValue(RECORD);

      const result = await repo.findById(TENANT, ID);

      expect(delegate.findFirst).toHaveBeenCalledWith({
        where: { id: ID, tenantId: TENANT },
      });
      expect(result).toEqual(RECORD);
    });

    it('returns null when the record does not exist', async () => {
      delegate.findFirst.mockResolvedValue(null);
      const result = await repo.findById(TENANT, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('calls delegate.findMany with tenantId and no extra filters by default', async () => {
      delegate.findMany.mockResolvedValue([RECORD]);

      const result = await repo.findMany(TENANT);

      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
      });
      expect(result).toEqual([RECORD]);
    });

    it('merges caller-supplied filters into where clause alongside tenantId', async () => {
      delegate.findMany.mockResolvedValue([]);

      await repo.findMany(TENANT, { isActive: true, provider: 'openai' });

      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { isActive: true, provider: 'openai', tenantId: TENANT },
      });
    });

    it('tenantId in filters is always overwritten by the guarded tenantId', async () => {
      delegate.findMany.mockResolvedValue([]);

      // Caller sneaks a different tenantId in filters — ours must win.
      await repo.findMany(TENANT, { tenantId: 'other-tenant' });

      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
      });
    });
  });

  describe('create', () => {
    it('calls delegate.create with tenantId injected into data', async () => {
      delegate.create.mockResolvedValue(RECORD);

      const result = await repo.create(TENANT, { name: 'hello' });

      expect(delegate.create).toHaveBeenCalledWith({
        data: { name: 'hello', tenantId: TENANT },
      });
      expect(result).toEqual(RECORD);
    });

    it('tenantId in caller data is always overwritten', async () => {
      delegate.create.mockResolvedValue(RECORD);

      await repo.create(TENANT, { name: 'x', tenantId: 'injected-by-caller' });

      expect(delegate.create).toHaveBeenCalledWith({
        data: { name: 'x', tenantId: TENANT },
      });
    });
  });

  describe('update', () => {
    it('calls delegate.update with tenantId in where and caller data', async () => {
      delegate.update.mockResolvedValue({ ...RECORD, name: 'updated' });

      const result = await repo.update(TENANT, ID, { name: 'updated' });

      expect(delegate.update).toHaveBeenCalledWith({
        where: { id: ID, tenantId: TENANT },
        data: { name: 'updated' },
      });
      expect(result).toEqual({ ...RECORD, name: 'updated' });
    });
  });

  describe('delete', () => {
    it('calls delegate.delete with id and tenantId in where clause', async () => {
      delegate.delete.mockResolvedValue(undefined);

      await repo.delete(TENANT, ID);

      expect(delegate.delete).toHaveBeenCalledWith({
        where: { id: ID, tenantId: TENANT },
      });
    });

    it('returns void (never exposes the deleted record)', async () => {
      delegate.delete.mockResolvedValue(RECORD);
      const result = await repo.delete(TENANT, ID);
      expect(result).toBeUndefined();
    });
  });
});
