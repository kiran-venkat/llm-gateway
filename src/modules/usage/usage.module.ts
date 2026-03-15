import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '../cache/cache.module';
import { CacheJob } from './jobs/cache.job';
import { UsageJob } from './jobs/usage.job';
import { CostCalculatorService } from './cost-calculator.service';
import { UsageRepository } from './usage.repository';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'cache' }),
    BullModule.registerQueue({ name: 'usage' }),
    CacheModule,
  ],
  providers: [CacheJob, UsageJob, CostCalculatorService, UsageRepository],
  exports: [CostCalculatorService, UsageRepository],
})
export class UsageModule {}
