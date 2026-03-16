import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';

@Module({
  imports: [TenantsModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysRepository, ApiKeysService],
  exports: [ApiKeysService, ApiKeysRepository],
})
export class ApiKeysModule {}
