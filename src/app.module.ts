import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [AppConfigModule, PrismaModule, TenantsModule, ApiKeysModule],
})
export class AppModule {}
