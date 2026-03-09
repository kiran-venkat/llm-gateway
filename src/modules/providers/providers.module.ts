import { Module } from '@nestjs/common';
import { AdapterRegistry } from './registry/adapter.registry';

@Module({
  providers: [AdapterRegistry],
  exports: [AdapterRegistry],
})
export class ProvidersModule {}
