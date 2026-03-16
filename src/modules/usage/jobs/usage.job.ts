import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Job } from 'bull';
import { Redis } from 'ioredis';
import { UsageRepository } from '../usage.repository';
import { CostCalculatorService } from '../cost-calculator.service';
import {
  BudgetCheckerService,
  secondsUntilEndOfMonth,
} from '../budget-checker.service';

export interface UsageJobData {
  requestId: string;
  tenantId: string;
  apiKeyId: string;
  provider: string;
  model: string;
  requestedModel: string;
  status: 'success' | 'error' | 'cached' | 'rate_limited';
  cacheHit: boolean;
  cacheType?: 'exact' | 'semantic';
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  ttfbMs?: number;
  stream: boolean;
  errorCode?: string;
  createdAt: string; // ISO timestamp
}

@Processor('usage')
export class UsageJob {
  private readonly logger = new Logger(UsageJob.name);

  constructor(
    private readonly usageRepo: UsageRepository,
    private readonly costCalculator: CostCalculatorService,
    private readonly budgetChecker: BudgetCheckerService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Process('track-usage')
  async process(job: Job<UsageJobData>): Promise<void> {
    // Shallow copy so we can patch costUsd without mutating the job data
    const data: UsageJobData = { ...job.data };

    // Step 1: Calculate cost if not already set.
    // GatewayService pre-calculates cost on the non-streaming path, but
    // streaming sends costUsd=0 (no token counts until stream ends).
    // The job recalculates here as the safety net for both cases.
    if (data.costUsd === 0 && data.status === 'success') {
      data.costUsd = await this.costCalculator.calculateCost(
        data.provider,
        data.model,
        data.promptTokens,
        data.completionTokens,
      );
    }

    // Step 2: Write request record
    await this.usageRepo.createRequest(data);

    // Step 3: Upsert daily aggregates
    await this.usageRepo.upsertDailyUsage(data);

    // Step 4: Log completion
    this.logger.log(
      `Usage tracked: ${data.provider}/${data.model} ` +
        `${data.promptTokens}+${data.completionTokens} tokens ` +
        `$${data.costUsd.toFixed(8)}`,
    );

    // Step 5: Budget check — log warn/error, set Redis block key when exceeded.
    // Fire after DB writes so the sum in usage_daily already includes this request.
    const budget = await this.budgetChecker.checkBudget(
      data.tenantId,
      data.costUsd,
    );

    if (budget.status === 'warning') {
      this.logger.warn(
        `Tenant ${data.tenantId} at ${budget.pct!.toFixed(1)}% of monthly budget ` +
          `($${budget.monthlySpend!.toFixed(4)} / $${budget.monthlyBudget})`,
      );
    }

    if (budget.status === 'exceeded') {
      this.logger.error(
        `Tenant ${data.tenantId} EXCEEDED monthly budget ` +
          `($${budget.monthlySpend!.toFixed(4)} / $${budget.monthlyBudget})`,
      );
      // Set a Redis flag that RateLimitGuard checks on every request.
      // TTL = seconds until end of current month so the block auto-lifts
      // at the start of the new billing period.
      await this.redis.set(
        `tenant:${data.tenantId}:budget:exceeded`,
        '1',
        'EX',
        secondsUntilEndOfMonth(),
      );
    }
  }
}
