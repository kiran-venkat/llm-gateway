import { Module, OnModuleInit } from '@nestjs/common';
import { AdapterRegistry } from './registry/adapter.registry';
import { AnthropicAdapter } from './adapters/anthropic/anthropic.adapter';
import { OpenAIAdapter } from './adapters/openai/openai.adapter';
import { GeminiAdapter } from './adapters/gemini/gemini.adapter';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderConfigsController } from './provider-configs.controller';

@Module({
  controllers: [ProviderConfigsController],
  providers: [
    AdapterRegistry,
    ProviderConfigsRepository,
    ProviderConfigsService,
  ],
  exports: [AdapterRegistry, ProviderConfigsRepository, ProviderConfigsService],
})
export class ProvidersModule implements OnModuleInit {
  constructor(private readonly registry: AdapterRegistry) {}

  onModuleInit(): void {
    this.registry.register(new AnthropicAdapter());
    this.registry.register(new OpenAIAdapter());
    this.registry.register(new GeminiAdapter());
  }
}
