// APIError must be imported as a named export — not Anthropic.APIError.
// When Jest mocks the module, named exports survive but namespace-style
// access points to the mock default, breaking instanceof checks in mapError().
import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { IProviderAdapter } from '../../../../common/interfaces/provider-adapter.interface';
import {
  GatewayRequest,
  Message,
} from '../../../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../../../common/dto/gateway-response.dto';
import { StreamChunk } from '../../../../common/dto/stream-chunk.dto';
import { GatewayError } from '../../../../common/dto/gateway-error.dto';

export class AnthropicAdapter implements IProviderAdapter {
  readonly name = 'anthropic';

  async complete(
    request: GatewayRequest,
    apiKey: string,
  ): Promise<GatewayResponse> {
    try {
      const client = new Anthropic({ apiKey });

      // .find() picks the FIRST system message (not the last) — intentional.
      // Anthropic's API requires system content as a top-level param, not inside
      // the messages array; all system messages are stripped from messages[].
      const systemMessage = request.messages.find(
        (m) => m.role === 'system',
      )?.content;
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const resp = await client.messages.create({
        model: request.model,
        // Anthropic requires max_tokens with no server-side default; 1024 is a
        // conservative fallback to prevent runaway cost. Do not remove.
        max_tokens: request.maxTokens ?? 1024,
        ...(systemMessage !== undefined && { system: systemMessage }),
        messages,
      });

      const firstBlock = resp.content[0];
      const content = firstBlock.type === 'text' ? firstBlock.text : '';

      const finishReason = this.mapStopReason(resp.stop_reason);

      return {
        content,
        model: resp.model,
        provider: 'anthropic',
        promptTokens: resp.usage.input_tokens,
        completionTokens: resp.usage.output_tokens,
        totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
        finishReason,
      };
    } catch (err: unknown) {
      throw this.mapError(err);
    }
  }

  async *completeStream(
    request: GatewayRequest,
    apiKey: string,
  ): AsyncIterable<StreamChunk> {
    const client = new Anthropic({ apiKey });

    // Same .find() / strip pattern as complete() — see comment above.
    const systemMessage = request.messages.find(
      (m) => m.role === 'system',
    )?.content;
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const stream = client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      ...(systemMessage !== undefined && { system: systemMessage }),
      messages,
    });

    let chunkIndex = 0;

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield {
          content: event.delta.text,
          index: chunkIndex++,
          done: false,
        };
      }
    }

    yield {
      content: '',
      index: chunkIndex,
      done: true,
    };
  }

  estimateTokens(messages: Message[]): number {
    return Math.ceil(
      messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
    );
  }

  mapError(error: unknown): GatewayError {
    if (error instanceof APIError) {
      const message = error.message;

      if (error.status === 401) {
        return {
          code: 'auth_error',
          message,
          provider: 'anthropic',
          retryable: false,
          statusCode: 401,
        };
      }

      if (error.status === 404) {
        return {
          code: 'invalid_model',
          message,
          provider: 'anthropic',
          retryable: false,
          statusCode: 400,
        };
      }

      if (error.status === 429) {
        return {
          code: 'rate_limit',
          message,
          provider: 'anthropic',
          retryable: true,
          statusCode: 429,
        };
      }

      if (error.status === 529) {
        return {
          code: 'provider_unavailable',
          message,
          provider: 'anthropic',
          retryable: true,
          statusCode: 503,
        };
      }

      if (error.status === 400 && message.toLowerCase().includes('context')) {
        return {
          code: 'context_too_long',
          message,
          provider: 'anthropic',
          retryable: false,
          statusCode: 400,
        };
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      code: 'unknown',
      message,
      provider: 'anthropic',
      retryable: false,
      statusCode: 500,
    };
  }

  private mapStopReason(
    stopReason: string | null,
  ): 'stop' | 'length' | 'error' {
    if (stopReason === 'max_tokens') return 'length';
    return 'stop';
  }
}
