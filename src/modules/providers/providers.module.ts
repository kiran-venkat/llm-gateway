import { Module, OnModuleInit } from '@nestjs/common';
import { AdapterRegistry } from './registry/adapter.registry';
import { AnthropicAdapter } from './adapters/anthropic/anthropic.adapter';
import { OpenAIAdapter } from './adapters/openai/openai.adapter';
import { GeminiAdapter } from './adapters/gemini/gemini.adapter';

@Module({
  providers: [AdapterRegistry],
  exports: [AdapterRegistry],
})
export class ProvidersModule implements OnModuleInit {
  constructor(private readonly registry: AdapterRegistry) {}

  onModuleInit(): void {
    this.registry.register(new AnthropicAdapter());
    this.registry.register(new OpenAIAdapter());
    this.registry.register(new GeminiAdapter());
  }
}
