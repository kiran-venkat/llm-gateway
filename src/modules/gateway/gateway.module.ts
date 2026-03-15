import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RouterModule } from '../router/router.module';
import { ProvidersModule } from '../providers/providers.module';
import { StreamModule } from '../stream/stream.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TenantsModule } from '../tenants/tenants.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { CacheModule } from '../cache/cache.module';
import { UsageModule } from '../usage/usage.module';
import { GatewayService } from './gateway.service';
import { GatewayController } from './gateway.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'usage' }),
    BullModule.registerQueue({ name: 'cache' }),
    RouterModule,
    ProvidersModule,
    StreamModule,
    ApiKeysModule,
    TenantsModule,
    RateLimitModule,
    CacheModule,
    UsageModule,
  ],
  providers: [GatewayService],
  controllers: [GatewayController],
})
export class GatewayModule {}
