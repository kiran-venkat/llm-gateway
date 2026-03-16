import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface BudgetStatus {
  status: 'ok' | 'warning' | 'exceeded';
  pct: number | null;
  monthlySpend?: number;
  monthlyBudget?: number;
}

/**
 * Returns seconds from now until midnight on the first day of next month.
 * Used as the Redis TTL for the budget:exceeded key — the block automatically
 * lifts when the new billing period begins.
 *
 * Exported so it can be independently unit-tested.
 */
export function secondsUntilEndOfMonth(): number {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000);
}

@Injectable()
export class BudgetCheckerService {
  private readonly logger = new Logger(BudgetCheckerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check a tenant's spend against their monthly budget.
   *
   * @param tenantId  The tenant to check.
   * @param _costJustAdded  The cost added in this request (reserved for future
   *   optimistic add-before-flush logic; currently the DB sum already includes
   *   the just-upserted cost because this is called after upsertDailyUsage).
   */
  async checkBudget(
    tenantId: string,
    _costJustAdded: number,
  ): Promise<BudgetStatus> {
    // Step 1: Load tenant — no budget configured means no limit
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { monthlyBudgetUsd: true },
    });
    if (!tenant?.monthlyBudgetUsd) {
      return { status: 'ok', pct: null };
    }

    const monthlyBudget = Number(tenant.monthlyBudgetUsd);

    // Step 2: Sum this month's spend from the daily aggregates table.
    // COALESCE ensures we get 0 (not NULL) when no rows exist this month.
    const rows = await this.prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM("totalCostUsd"), 0) AS total
      FROM usage_daily
      WHERE "tenantId" = ${tenantId}::uuid
      AND date >= date_trunc('month', CURRENT_DATE)
    `;

    const monthlySpend = rows.length > 0 ? Number(rows[0].total) : 0;

    // Step 3: Percentage of budget consumed
    const pct = (monthlySpend / monthlyBudget) * 100;

    // Step 4: Return tiered status
    if (pct >= 100) {
      return { status: 'exceeded', pct, monthlySpend, monthlyBudget };
    }
    if (pct >= 80) {
      return { status: 'warning', pct, monthlySpend, monthlyBudget };
    }
    return { status: 'ok', pct, monthlySpend, monthlyBudget };
  }
}
