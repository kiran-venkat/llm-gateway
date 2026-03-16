import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CacheModule } from '../cache/cache.module';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [ApiKeysModule, TenantsModule, CacheModule],
  providers: [AnalyticsRepository, AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
