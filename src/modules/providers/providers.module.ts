import { Module, OnModuleInit } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdapterRegistry } from './registry/adapter.registry';
import { AnthropicAdapter } from './adapters/anthropic/anthropic.adapter';
import { OpenAIAdapter } from './adapters/openai/openai.adapter';
import { GeminiAdapter } from './adapters/gemini/gemini.adapter';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderConfigsController } from './provider-configs.controller';

@Module({
  imports: [ApiKeysModule, TenantsModule],
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
    // Adapters are instantiated with new() — they create SDK clients per-request
    // and have no NestJS service dependencies. Do not add constructor params to
    // adapters; if one needs a NestJS service, convert it to a proper provider.
    this.registry.register(new AnthropicAdapter());
    this.registry.register(new OpenAIAdapter());
    this.registry.register(new GeminiAdapter());
  }
}
