import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { PrismaModule } from './prisma/prisma.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { TenantsModule } from './modules/tenants/tenants.module';

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
    PrismaModule,
    TenantsModule,
    ApiKeysModule,
  ],
})
export class AppModule {}
