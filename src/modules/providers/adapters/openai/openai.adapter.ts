import OpenAI, { APIError } from 'openai';
import { IProviderAdapter } from '../../../../common/interfaces/provider-adapter.interface';
import {
  GatewayRequest,
  Message,
} from '../../../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../../../common/dto/gateway-response.dto';
import { StreamChunk } from '../../../../common/dto/stream-chunk.dto';
import { GatewayError } from '../../../../common/dto/gateway-error.dto';

export class OpenAIAdapter implements IProviderAdapter {
  readonly name = 'openai';

  async complete(
    request: GatewayRequest,
    apiKey: string,
  ): Promise<GatewayResponse> {
    try {
      const client = new OpenAI({ apiKey });

      const resp = await client.chat.completions.create({
        model: request.model,
        messages: request.messages,
        ...(request.maxTokens !== undefined && {
          max_tokens: request.maxTokens,
        }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
      });

      return {
        content: resp.choices[0].message.content ?? '',
        model: resp.model,
        provider: 'openai',
        promptTokens: resp.usage?.prompt_tokens ?? 0,
        completionTokens: resp.usage?.completion_tokens ?? 0,
        totalTokens: resp.usage?.total_tokens ?? 0,
        finishReason: this.mapFinishReason(resp.choices[0].finish_reason),
      };
    } catch (err: unknown) {
      throw this.mapError(err);
    }
  }

  async *completeStream(
    request: GatewayRequest,
    apiKey: string,
  ): AsyncIterable<StreamChunk> {
    const client = new OpenAI({ apiKey });

    const stream = await client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && {
        temperature: request.temperature,
      }),
      stream: true,
    });

    let chunkIndex = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      // Skip empty/null deltas — OpenAI sends these on the first and last chunks
      if (!content) continue;

      yield {
        content,
        index: chunkIndex++,
        done: false,
      };
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
          provider: 'openai',
          retryable: false,
          statusCode: 401,
        };
      }

      if (error.status === 404) {
        return {
          code: 'invalid_model',
          message,
          provider: 'openai',
          retryable: false,
          statusCode: 400,
        };
      }

      if (error.status === 429) {
        return {
          code: 'rate_limit',
          message,
          provider: 'openai',
          retryable: true,
          statusCode: 429,
        };
      }

      if (
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503
      ) {
        return {
          code: 'provider_unavailable',
          message,
          provider: 'openai',
          retryable: true,
          statusCode: 503,
        };
      }

      if (error.status === 400 && message.includes('context_length')) {
        return {
          code: 'context_too_long',
          message,
          provider: 'openai',
          retryable: false,
          statusCode: 400,
        };
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      code: 'unknown',
      message,
      provider: 'openai',
      retryable: false,
      statusCode: 500,
    };
  }

  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'error' {
    if (reason === 'length') return 'length';
    return 'stop';
  }
}
