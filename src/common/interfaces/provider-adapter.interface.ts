import { GatewayError } from '../dto/gateway-error.dto';
import { GatewayRequest, Message } from '../dto/gateway-request.dto';
import { GatewayResponse } from '../dto/gateway-response.dto';
import { StreamChunk } from '../dto/stream-chunk.dto';

export interface IProviderAdapter {
  /** Unique provider name, e.g. 'openai' | 'anthropic' | 'gemini' */
  readonly name: string;

  /**
   * Non-streaming completion.
   * Returns a fully-resolved GatewayResponse once the provider responds.
   * Result is safe to cache.
   */
  complete(request: GatewayRequest, apiKey: string): Promise<GatewayResponse>;

  /**
   * Streaming completion.
   * Returns an AsyncIterable of StreamChunk. The final chunk has done=true.
   * Cannot be cached — caller must consume the stream.
   */
  completeStream(request: GatewayRequest, apiKey: string): AsyncIterable<StreamChunk>;

  /**
   * Cheap token estimate without a network call.
   * Used by the rate-limit guard before forwarding the request.
   */
  estimateTokens(messages: Message[]): number;

  /**
   * Normalise any provider SDK error into a GatewayError.
   * Called in catch blocks inside complete() and completeStream().
   */
  mapError(error: unknown): GatewayError;
}
