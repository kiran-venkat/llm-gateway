import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '../cache/cache.module';
import { CacheJob } from './jobs/cache.job';
import { CostCalculatorService } from './cost-calculator.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'cache' }), CacheModule],
  providers: [CacheJob, CostCalculatorService],
  exports: [CostCalculatorService],
})
export class UsageModule {}
