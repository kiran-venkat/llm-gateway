/* eslint-disable @typescript-eslint/no-unused-vars */
import { AdapterRegistry, ProviderNotFoundError } from './adapter.registry';
import { IProviderAdapter } from '../../../common/interfaces/provider-adapter.interface';
import {
  GatewayRequest,
  Message,
} from '../../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../../common/dto/gateway-response.dto';
import { StreamChunk } from '../../../common/dto/stream-chunk.dto';
import { GatewayError } from '../../../common/dto/gateway-error.dto';

function makeAdapter(name: string): IProviderAdapter {
  return {
    name,
    complete(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _request: GatewayRequest,
      _apiKey: string,
    ): Promise<GatewayResponse> {
      return Promise.resolve({} as GatewayResponse);
    },
    async *completeStream(
      _request: GatewayRequest,
      _apiKey: string,
    ): AsyncIterable<StreamChunk> {
      yield {} as StreamChunk;
    },
    estimateTokens(_messages: Message[]): number {
      return 0;
    },
    mapError(_error: unknown): GatewayError {
      return {} as GatewayError;
    },
  };
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('register() then get() returns the correct adapter', () => {
    const adapter = makeAdapter('openai');
    registry.register(adapter);
    expect(registry.get('openai')).toBe(adapter);
  });

  it('get() on unknown provider throws ProviderNotFoundError with correct name', () => {
    expect(() => registry.get('unknown-provider')).toThrow(
      ProviderNotFoundError,
    );
    expect(() => registry.get('unknown-provider')).toThrow(
      "Provider 'unknown-provider' is not registered",
    );

    try {
      registry.get('unknown-provider');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderNotFoundError);
      expect((err as ProviderNotFoundError).provider).toBe('unknown-provider');
      expect((err as ProviderNotFoundError).code).toBe('PROVIDER_NOT_FOUND');
    }
  });

  it('register() same name twice throws Error', () => {
    registry.register(makeAdapter('openai'));
    expect(() => registry.register(makeAdapter('openai'))).toThrow(
      "Adapter 'openai' is already registered",
    );
  });

  it('list() returns all registered provider names', () => {
    expect(registry.list()).toEqual([]);
    registry.register(makeAdapter('openai'));
    registry.register(makeAdapter('anthropic'));
    registry.register(makeAdapter('gemini'));
    expect(registry.list()).toEqual(['openai', 'anthropic', 'gemini']);
  });

  it('has() returns true for registered providers and false otherwise', () => {
    expect(registry.has('openai')).toBe(false);
    registry.register(makeAdapter('openai'));
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('anthropic')).toBe(false);
  });
});
