import {
  BudgetCheckerService,
  BudgetStatus,
  secondsUntilEndOfMonth,
} from './budget-checker.service';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-11111111-2222-3333-4444-555555555555';

function makePrisma(opts: {
  monthlyBudgetUsd: number | null;
  monthlySpend: number;
}): jest.Mocked<PrismaService> {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(
        opts.monthlyBudgetUsd === null
          ? null
          : { monthlyBudgetUsd: opts.monthlyBudgetUsd },
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ total: opts.monthlySpend }]),
  } as unknown as jest.Mocked<PrismaService>;
}

// ---------------------------------------------------------------------------
// secondsUntilEndOfMonth
// ---------------------------------------------------------------------------

describe('secondsUntilEndOfMonth', () => {
  it('returns a positive number', () => {
    expect(secondsUntilEndOfMonth()).toBeGreaterThan(0);
  });

  it('returns at most 31 days worth of seconds', () => {
    expect(secondsUntilEndOfMonth()).toBeLessThanOrEqual(31 * 24 * 60 * 60);
  });

  it('is a whole number (Math.ceil applied)', () => {
    expect(Number.isInteger(secondsUntilEndOfMonth())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BudgetCheckerService.checkBudget
// ---------------------------------------------------------------------------

describe('BudgetCheckerService', () => {
  describe('checkBudget', () => {
    it('returns ok with pct=null when tenant has no monthly budget set', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: null, monthlySpend: 999 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result).toEqual<BudgetStatus>({ status: 'ok', pct: null });
      // Should not hit the usage_daily query at all
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns ok when tenant has no row in the DB (spend = 0)', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 0 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('ok');
      expect(result.pct).toBeCloseTo(0, 5);
    });

    it('returns ok at 50% spend', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 50 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('ok');
      expect(result.pct).toBeCloseTo(50, 5);
      expect(result.monthlySpend).toBeCloseTo(50, 5);
      expect(result.monthlyBudget).toBe(100);
    });

    it('returns warning at 85% spend', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 85 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('warning');
      expect(result.pct).toBeCloseTo(85, 5);
    });

    it('returns warning at exactly 80% spend', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 80 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('warning');
    });

    it('returns exceeded at 105% spend', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 105 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('exceeded');
      expect(result.pct).toBeCloseTo(105, 5);
      expect(result.monthlySpend).toBeCloseTo(105, 5);
      expect(result.monthlyBudget).toBe(100);
    });

    it('returns exceeded at exactly 100% spend', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 50, monthlySpend: 50 });
      const svc = new BudgetCheckerService(prisma);

      const result = await svc.checkBudget(TENANT_ID, 0);

      expect(result.status).toBe('exceeded');
    });

    it('queries usage_daily with $queryRaw', async () => {
      const prisma = makePrisma({ monthlyBudgetUsd: 100, monthlySpend: 10 });
      const svc = new BudgetCheckerService(prisma);

      await svc.checkBudget(TENANT_ID, 0);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Verify the tenantId is interpolated into the query
      const [, ...values] = (prisma.$queryRaw as jest.Mock).mock
        .calls[0] as unknown[];
      expect(values).toContain(TENANT_ID);
    });
  });
});
