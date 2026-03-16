import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '../cache/cache.module';
import { CacheJob } from './jobs/cache.job';
import { UsageJob } from './jobs/usage.job';
import { CostCalculatorService } from './cost-calculator.service';
import { UsageRepository } from './usage.repository';
import { BudgetCheckerService } from './budget-checker.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'cache' }),
    BullModule.registerQueue({ name: 'usage' }),
    CacheModule,
  ],
  providers: [CacheJob, UsageJob, CostCalculatorService, UsageRepository, BudgetCheckerService],
  exports: [CostCalculatorService, UsageRepository, BudgetCheckerService],
})
export class UsageModule {}
