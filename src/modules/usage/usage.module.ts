import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '../cache/cache.module';
import { CacheJob } from './jobs/cache.job';

@Module({
  imports: [BullModule.registerQueue({ name: 'cache' }), CacheModule],
  providers: [CacheJob],
})
export class UsageModule {}
