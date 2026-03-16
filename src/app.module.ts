import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisModule } from '@nestjs-modules/ioredis';
import { BullModule } from '@nestjs/bull';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { PrismaModule } from './prisma/prisma.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    RedisModule.forRootAsync({
      imports: [AppConfigModule],
      useFactory: (config: AppConfigService) => ({
        type: 'single' as const,
        url: config.getRedisUrl(),
      }),
      inject: [AppConfigService],
    }),
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      useFactory: (config: AppConfigService) => ({
        redis: config.getRedisUrl(),
      }),
      inject: [AppConfigService],
    }),
    PrismaModule,
    TenantsModule,
    ApiKeysModule,
    ProvidersModule,
    GatewayModule,
    AnalyticsModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
