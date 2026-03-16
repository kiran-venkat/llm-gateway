import { Job } from 'bull';
import { Redis } from 'ioredis';
import { UsageJob, UsageJobData } from './usage.job';
import { UsageRepository } from '../usage.repository';
import { CostCalculatorService } from '../cost-calculator.service';
import { BudgetCheckerService, BudgetStatus } from '../budget-checker.service';
import { PrismaService } from '../../../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJobData(overrides: Partial<UsageJobData> = {}): UsageJobData {
  return {
    requestId: 'req-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: 'tenant-11111111-2222-3333-4444-555555555555',
    apiKeyId: 'key-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    requestedModel: 'claude-haiku-4-5-20251001',
    status: 'success',
    cacheHit: false,
    promptTokens: 16,
    completionTokens: 6,
    costUsd: 0.0000368,
    latencyMs: 420,
    stream: false,
    createdAt: '2026-03-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeJob(data: UsageJobData): Job<UsageJobData> {
  return { data } as Job<UsageJobData>;
}

function makeUsageRepo(): jest.Mocked<UsageRepository> {
  return {
    createRequest: jest.fn().mockResolvedValue(undefined),
    upsertDailyUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<UsageRepository>;
}

function makeCostCalculator(cost = 0.0000368): jest.Mocked<CostCalculatorService> {
  return {
    calculateCost: jest.fn().mockResolvedValue(cost),
  } as unknown as jest.Mocked<CostCalculatorService>;
}

function makeBudgetChecker(
  status: BudgetStatus['status'] = 'ok',
  pct = 10,
): jest.Mocked<BudgetCheckerService> {
  const result: BudgetStatus =
    status === 'ok' && pct === 10
      ? { status: 'ok', pct: 10, monthlySpend: 1, monthlyBudget: 10 }
      : status === 'warning'
        ? { status: 'warning', pct, monthlySpend: pct, monthlyBudget: 100 }
        : { status: 'exceeded', pct, monthlySpend: pct, monthlyBudget: 100 };
  return {
    checkBudget: jest.fn().mockResolvedValue(result),
  } as unknown as jest.Mocked<BudgetCheckerService>;
}

function makeRedis(): jest.Mocked<Pick<Redis, 'get' | 'set'>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  } as unknown as jest.Mocked<Pick<Redis, 'get' | 'set'>>;
}

// ---------------------------------------------------------------------------
// UsageJob processor tests
// ---------------------------------------------------------------------------

describe('UsageJob', () => {
  let usageRepo: jest.Mocked<UsageRepository>;
  let costCalculator: jest.Mocked<CostCalculatorService>;
  let budgetChecker: jest.Mocked<BudgetCheckerService>;
  let mockRedis: jest.Mocked<Pick<Redis, 'get' | 'set'>>;
  let job: UsageJob;

  beforeEach(() => {
    usageRepo = makeUsageRepo();
    costCalculator = makeCostCalculator();
    budgetChecker = makeBudgetChecker();
    mockRedis = makeRedis();
    job = new UsageJob(
      usageRepo,
      costCalculator,
      budgetChecker,
      mockRedis as unknown as Redis,
    );
  });

  it('calls createRequest with the correct job data', async () => {
    const data = makeJobData();
    await job.process(makeJob(data));

    expect(usageRepo.createRequest).toHaveBeenCalledTimes(1);
    expect(usageRepo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<UsageJobData>>({
        requestId: data.requestId,
        tenantId: data.tenantId,
        provider: data.provider,
        model: data.model,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
      }),
    );
  });

  it('calls upsertDailyUsage after createRequest', async () => {
    const callOrder: string[] = [];
    usageRepo.createRequest.mockImplementation(async () => {
      callOrder.push('createRequest');
    });
    usageRepo.upsertDailyUsage.mockImplementation(async () => {
      callOrder.push('upsertDailyUsage');
    });

    await job.process(makeJob(makeJobData()));

    expect(callOrder).toEqual(['createRequest', 'upsertDailyUsage']);
  });

  it('calculates cost when costUsd is 0 and status is success', async () => {
    const data = makeJobData({ costUsd: 0, status: 'success' });
    costCalculator.calculateCost.mockResolvedValue(0.0000368);

    await job.process(makeJob(data));

    expect(costCalculator.calculateCost).toHaveBeenCalledWith(
      data.provider,
      data.model,
      data.promptTokens,
      data.completionTokens,
    );
    // The recalculated cost is passed to the repo
    expect(usageRepo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.0000368 }),
    );
  });

  it('does NOT recalculate cost when costUsd is already set', async () => {
    const data = makeJobData({ costUsd: 0.005 });
    await job.process(makeJob(data));

    expect(costCalculator.calculateCost).not.toHaveBeenCalled();
    expect(usageRepo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.005 }),
    );
  });

  it('does NOT recalculate cost when status is not success (even if costUsd is 0)', async () => {
    const data = makeJobData({ costUsd: 0, status: 'error' });
    await job.process(makeJob(data));

    expect(costCalculator.calculateCost).not.toHaveBeenCalled();
  });

  it('does not throw when repository throws — lets BullMQ handle retry', async () => {
    usageRepo.createRequest.mockRejectedValue(new Error('DB connection lost'));

    await expect(job.process(makeJob(makeJobData()))).rejects.toThrow(
      'DB connection lost',
    );
    // upsertDailyUsage should NOT be called if createRequest fails
    expect(usageRepo.upsertDailyUsage).not.toHaveBeenCalled();
  });

  it('does not set Redis key when budget status is warning (80%+)', async () => {
    budgetChecker = makeBudgetChecker('warning', 85);
    job = new UsageJob(
      usageRepo,
      costCalculator,
      budgetChecker,
      mockRedis as unknown as Redis,
    );

    await job.process(makeJob(makeJobData()));

    // Budget warn logging is now owned by BudgetCheckerService, not UsageJob.
    // UsageJob only sets the Redis block key on exceeded — not on warning.
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('sets Redis budget:exceeded key when budget is exceeded', async () => {
    budgetChecker = makeBudgetChecker('exceeded', 105);
    job = new UsageJob(
      usageRepo,
      costCalculator,
      budgetChecker,
      mockRedis as unknown as Redis,
    );

    const data = makeJobData();
    await job.process(makeJob(data));

    // Budget error logging is now owned by BudgetCheckerService.
    // UsageJob is responsible for setting the Redis block key.
    expect(mockRedis.set).toHaveBeenCalledWith(
      `tenant:${data.tenantId}:budget:exceeded`,
      '1',
      'EX',
      expect.any(Number),
    );
    // TTL must be positive (seconds until end of month)
    const ttl = (mockRedis.set as jest.Mock).mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UsageRepository unit tests
// ---------------------------------------------------------------------------

describe('UsageRepository', () => {
  function makePrisma(): jest.Mocked<PrismaService> {
    return {
      request: {
        create: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<PrismaService>;
  }

  it('createRequest uses the pre-generated requestId as PK', async () => {
    const { UsageRepository: Repo } = await import('../usage.repository');
    const prisma = makePrisma();
    const repo = new Repo(prisma);
    const data = makeJobData({ requestId: 'req-fixed-id-1234' });

    await repo.createRequest(data);

    expect(prisma.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'req-fixed-id-1234' }),
      }),
    );
  });

  it('createRequest maps all fields including totalTokens sum', async () => {
    const { UsageRepository: Repo } = await import('../usage.repository');
    const prisma = makePrisma();
    const repo = new Repo(prisma);
    const data = makeJobData({ promptTokens: 16, completionTokens: 6 });

    await repo.createRequest(data);

    expect(prisma.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptTokens: 16,
          completionTokens: 6,
          totalTokens: 22,
        }),
      }),
    );
  });

  it('upsertDailyUsage calls $executeRaw exactly once', async () => {
    const { UsageRepository: Repo } = await import('../usage.repository');
    const prisma = makePrisma();
    const repo = new Repo(prisma);

    await repo.upsertDailyUsage(makeJobData());

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('upsertDailyUsage passes correct increment values to $executeRaw', async () => {
    const { UsageRepository: Repo } = await import('../usage.repository');
    const prisma = makePrisma();
    const repo = new Repo(prisma);
    const data = makeJobData({
      promptTokens: 16,
      completionTokens: 6,
      costUsd: 0.0000368,
      latencyMs: 420,
      status: 'success',
      cacheHit: false,
    });

    await repo.upsertDailyUsage(data);

    // $executeRaw tagged template calls the mock as f(stringsArray, v1, v2, ...)
    // Rest args (index 1+) are the interpolated values in order.
    const [, ...values] = (prisma.$executeRaw as jest.Mock).mock.calls[0] as unknown[];
    expect(values).toContain(data.tenantId);
    expect(values).toContain(data.provider);
    expect(values).toContain(data.model);
    // totalTokens = 16 + 6 = 22
    expect(values).toContain(22);
    // isSuccess = 1 for 'success'
    expect(values).toContain(1);
    // isCached = 0 for cacheHit:false
    expect(values).toContain(0);
  });
});
