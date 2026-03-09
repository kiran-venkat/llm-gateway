import { Module, OnModuleInit } from '@nestjs/common';
import { AdapterRegistry } from './registry/adapter.registry';
import { AnthropicAdapter } from './adapters/anthropic/anthropic.adapter';

@Module({
  providers: [AdapterRegistry],
  exports: [AdapterRegistry],
})
export class ProvidersModule implements OnModuleInit {
  constructor(private readonly registry: AdapterRegistry) {}

  onModuleInit(): void {
    this.registry.register(new AnthropicAdapter());
  }
}
