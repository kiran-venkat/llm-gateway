import { Module } from '@nestjs/common';
import { TenantsRepository } from './tenants.repository';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

@Module({
  controllers: [TenantsController],
  providers: [TenantsRepository, TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
