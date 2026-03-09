import { GoogleGenerativeAI } from '@google/generative-ai';
import { IProviderAdapter } from '../../../../common/interfaces/provider-adapter.interface';
import {
  GatewayRequest,
  Message,
} from '../../../../common/dto/gateway-request.dto';
import { GatewayResponse } from '../../../../common/dto/gateway-response.dto';
import { StreamChunk } from '../../../../common/dto/stream-chunk.dto';
import { GatewayError } from '../../../../common/dto/gateway-error.dto';

type GeminiRole = 'user' | 'model';

interface GeminiMessage {
  role: GeminiRole;
  parts: [{ text: string }];
}

export class GeminiAdapter implements IProviderAdapter {
  readonly name = 'gemini';

  async complete(
    request: GatewayRequest,
    apiKey: string,
  ): Promise<GatewayResponse> {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: request.model });
    const geminiMessages = this.translateMessages(request.messages);

    const resp = await model.generateContent({ contents: geminiMessages });

    const candidate = resp.response.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text ?? '';

    return {
      content,
      model: request.model,
      provider: 'gemini',
      promptTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: resp.response.usageMetadata?.totalTokenCount ?? 0,
      finishReason: this.mapFinishReason(candidate?.finishReason),
    };
  }

  async *completeStream(
    request: GatewayRequest,
    apiKey: string,
  ): AsyncIterable<StreamChunk> {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: request.model });
    const geminiMessages = this.translateMessages(request.messages);

    const streamResp = await model.generateContentStream({
      contents: geminiMessages,
    });

    let chunkIndex = 0;

    for await (const chunk of streamResp.stream) {
      const content = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
    const message = error instanceof Error ? error.message : String(error);

    // Google Generative AI SDK does not expose structured error codes or typed
    // error classes — status codes are embedded in the message string.
    // String matching is the only reliable detection method available.
    // Replace with structured checks if a future SDK version adds them.
    if (message.includes('429')) {
      return {
        code: 'rate_limit',
        message,
        provider: 'gemini',
        retryable: true,
        statusCode: 429,
      };
    }
    if (message.includes('401')) {
      return {
        code: 'auth_error',
        message,
        provider: 'gemini',
        retryable: false,
        statusCode: 401,
      };
    }
    if (message.includes('404')) {
      return {
        code: 'invalid_model',
        message,
        provider: 'gemini',
        retryable: false,
        statusCode: 400,
      };
    }
    if (message.includes('503')) {
      return {
        code: 'provider_unavailable',
        message,
        provider: 'gemini',
        retryable: true,
        statusCode: 503,
      };
    }
    if (message.toLowerCase().includes('context')) {
      return {
        code: 'context_too_long',
        message,
        provider: 'gemini',
        retryable: false,
        statusCode: 400,
      };
    }

    return {
      code: 'unknown',
      message,
      provider: 'gemini',
      retryable: false,
      statusCode: 500,
    };
  }

  /**
   * Translate GatewayRequest messages → Gemini content array.
   *
   * Rules applied in order:
   * 1. Extract system message and prepend to first user message text.
   * 2. Map roles: 'user' → 'user', 'assistant' → 'model', drop 'system'.
   * 3. Enforce alternating turns: insert empty opposite-role messages where needed.
   * 4. If first message is 'model', prepend an empty 'user' message.
   */
  translateMessages(messages: Message[]): GeminiMessage[] {
    // ── Step 1: extract system content ──────────────────────────────────────
    const systemContent = messages.find((m) => m.role === 'system')?.content;

    // ── Step 2: map roles, drop system messages ──────────────────────────────
    const mapped: GeminiMessage[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // ── Step 3: prepend system content to first user message ─────────────────
    // Mutates the GeminiMessage object in place — safe because `mapped` is a
    // local array created above; the original request.messages are not touched.
    if (systemContent) {
      const firstUser = mapped.find((m) => m.role === 'user');
      if (firstUser) {
        firstUser.parts[0].text = `${systemContent}\n\n${firstUser.parts[0].text}`;
      }
    }

    // ── Step 4: enforce first message is 'user' ──────────────────────────────
    if (mapped.length > 0 && mapped[0].role === 'model') {
      mapped.unshift({ role: 'user', parts: [{ text: '' }] });
    }

    // ── Step 5: enforce alternating turns ────────────────────────────────────
    const result: GeminiMessage[] = [];
    for (const msg of mapped) {
      const prev = result[result.length - 1];
      if (prev && prev.role === msg.role) {
        // Insert empty message of the opposite role
        const filler: GeminiRole = msg.role === 'user' ? 'model' : 'user';
        result.push({ role: filler, parts: [{ text: '' }] });
      }
      result.push(msg);
    }

    return result;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): 'stop' | 'length' | 'error' {
    if (reason === 'MAX_TOKENS') return 'length';
    return 'stop';
  }
}
