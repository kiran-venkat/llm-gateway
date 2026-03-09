import { Injectable } from '@nestjs/common';
import { IProviderAdapter } from '../../../common/interfaces/provider-adapter.interface';

export class ProviderNotFoundError extends Error {
  readonly code = 'PROVIDER_NOT_FOUND' as const;
  readonly provider: string;

  constructor(provider: string) {
    super(`Provider '${provider}' is not registered`);
    this.name = 'ProviderNotFoundError';
    this.provider = provider;
  }
}

@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<string, IProviderAdapter>();

  register(adapter: IProviderAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(
        `Adapter '${adapter.name}' is already registered — double registration is a bug`,
      );
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(provider: string): IProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new ProviderNotFoundError(provider);
    }
    return adapter;
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }
}
