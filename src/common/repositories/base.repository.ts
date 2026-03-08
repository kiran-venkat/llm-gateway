/**
 * Typed domain error thrown when any repository method is called without a tenantId.
 * Prevents queries from ever running without tenant scope.
 */
export class MissingTenantIdError extends Error {
  readonly code = 'MISSING_TENANT_ID';

  constructor(operation: string) {
    super(`tenantId is required for operation: ${operation}`);
    this.name = 'MissingTenantIdError';
  }
}

/**
 * Minimal interface representing the CRUD surface we need from a Prisma model delegate.
 *
 * Prisma's generated delegate types are extremely complex generics that cannot be
 * parameterised in a generic base class without losing safety. We define this narrower
 * interface here; concrete repositories cast their Prisma delegates to it once in their
 * constructor, restoring full type safety in the subclass layer.
 */
export interface PrismaDelegate<T> {
  findFirst(args: { where: Record<string, unknown> }): Promise<T | null>;
  findMany(args: { where: Record<string, unknown> }): Promise<T[]>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<T>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Base repository class for all tenant-scoped Prisma models.
 *
 * Every public method requires `tenantId` as its first argument and automatically
 * injects it into the underlying Prisma query. Calling any method with an empty or
 * whitespace tenantId throws `MissingTenantIdError` before touching the database.
 *
 * Usage in a concrete repository:
 *
 *   class ApiKeyRepository extends BaseRepository<ApiKey> {
 *     constructor(prisma: PrismaClient) {
 *       super(prisma.apiKey as unknown as PrismaDelegate<ApiKey>);
 *     }
 *   }
 */
export abstract class BaseRepository<T> {
  constructor(protected readonly delegate: PrismaDelegate<T>) {}

  protected guardTenantId(tenantId: string, operation: string): void {
    if (!tenantId || tenantId.trim() === '') {
      throw new MissingTenantIdError(operation);
    }
  }

  async findById(tenantId: string, id: string): Promise<T | null> {
    this.guardTenantId(tenantId, 'findById');
    return this.delegate.findFirst({ where: { id, tenantId } });
  }

  async findMany(
    tenantId: string,
    filters: Record<string, unknown> = {},
  ): Promise<T[]> {
    this.guardTenantId(tenantId, 'findMany');
    return this.delegate.findMany({ where: { ...filters, tenantId } });
  }

  async create(tenantId: string, data: Record<string, unknown>): Promise<T> {
    this.guardTenantId(tenantId, 'create');
    return this.delegate.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    this.guardTenantId(tenantId, 'update');
    return this.delegate.update({ where: { id, tenantId }, data });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    this.guardTenantId(tenantId, 'delete');
    await this.delegate.delete({ where: { id, tenantId } });
  }
}
