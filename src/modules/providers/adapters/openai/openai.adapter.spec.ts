import OpenAI, { APIError } from 'openai';
import { OpenAIAdapter } from './openai.adapter';
import { GatewayRequest } from '../../../../common/dto/gateway-request.dto';

// ---------------------------------------------------------------------------
// Mock the OpenAI SDK constructor
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();

jest.mock('openai', () => {
  const actual = jest.requireActual<typeof import('openai')>('openai');
  return {
    ...actual,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCompletion(
  overrides: Partial<OpenAI.Chat.Completions.ChatCompletion> = {},
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1234567890,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'hello world test', refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
    },
    ...overrides,
  } as OpenAI.Chat.Completions.ChatCompletion;
}

function makeChunk(
  content: string | null,
  index = 0,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1234567890,
    model: 'gpt-4o-mini',
    choices: [
      {
        index,
        delta: { role: 'assistant', content },
        finish_reason: null,
        logprobs: null,
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletionChunk;
}

function makeApiError(status: number, message = 'err'): APIError {
  return new APIError(status, undefined, message, new Headers());
}

// ---------------------------------------------------------------------------
// Unit tests — mocked SDK
// ---------------------------------------------------------------------------

describe('OpenAIAdapter (unit)', () => {
  let adapter: OpenAIAdapter;
  const FAKE_KEY = 'sk-test';

  beforeEach(() => {
    adapter = new OpenAIAdapter();
    mockCreate.mockReset();
  });

  // ── complete() ────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('passes messages through without transformation', async () => {
      let capturedArgs: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming | undefined;
      mockCreate.mockImplementation(
        async (args: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) => {
          capturedArgs = args;
          return makeCompletion();
        },
      );

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        tenantId: 'tenant-1',
      };

      await adapter.complete(request, FAKE_KEY);

      // System message stays in messages[] — OpenAI handles it natively
      expect(capturedArgs?.messages).toHaveLength(2);
      expect(capturedArgs?.messages[0].role).toBe('system');
      expect(capturedArgs?.messages[1].role).toBe('user');
    });

    it('maps prompt_tokens → promptTokens correctly', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion({
          usage: { prompt_tokens: 55, completion_tokens: 12, total_tokens: 67 },
        }),
      );

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);

      expect(result.promptTokens).toBe(55);
      expect(result.completionTokens).toBe(12);
      expect(result.totalTokens).toBe(67);
    });

    it('handles missing usage fields (usage can be null)', async () => {
      mockCreate.mockResolvedValue(makeCompletion({ usage: undefined }));

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);

      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it("maps finish_reason 'stop' → finishReason 'stop'", async () => {
      mockCreate.mockResolvedValue(
        makeCompletion({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok', refusal: null },
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
        }),
      );

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);
      expect(result.finishReason).toBe('stop');
    });

    it("maps finish_reason 'length' → finishReason 'length'", async () => {
      mockCreate.mockResolvedValue(
        makeCompletion({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'truncated', refusal: null },
              finish_reason: 'length',
              logprobs: null,
            },
          ],
        }),
      );

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);
      expect(result.finishReason).toBe('length');
    });
  });

  // ── completeStream() ──────────────────────────────────────────────────────

  describe('completeStream()', () => {
    it('skips empty content chunks (null and empty string)', async () => {
      async function* fakeStream() {
        yield makeChunk(null);        // first chunk — empty delta
        yield makeChunk('hello');
        yield makeChunk(' world');
        yield makeChunk('');          // empty string delta
        yield makeChunk(null);        // last chunk — empty delta
      }
      mockCreate.mockResolvedValue(fakeStream());

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const chunks = [];
      for await (const chunk of adapter.completeStream(request, FAKE_KEY)) {
        chunks.push(chunk);
      }

      // Only 'hello' and ' world' should appear (plus the terminal done chunk)
      const content = chunks.filter((c) => !c.done).map((c) => c.content);
      expect(content).toEqual(['hello', ' world']);
    });

    it('indexes content chunks sequentially starting at 0', async () => {
      async function* fakeStream() {
        yield makeChunk('a');
        yield makeChunk('b');
        yield makeChunk('c');
      }
      mockCreate.mockResolvedValue(fakeStream());

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const chunks = [];
      for await (const chunk of adapter.completeStream(request, FAKE_KEY)) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toMatchObject({ content: 'a', index: 0, done: false });
      expect(chunks[1]).toMatchObject({ content: 'b', index: 1, done: false });
      expect(chunks[2]).toMatchObject({ content: 'c', index: 2, done: false });
    });

    it('final chunk has done: true, empty content, index = content chunk count', async () => {
      async function* fakeStream() {
        yield makeChunk('hello');
        yield makeChunk(' world');
      }
      mockCreate.mockResolvedValue(fakeStream());

      const request: GatewayRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const chunks = [];
      for await (const chunk of adapter.completeStream(request, FAKE_KEY)) {
        chunks.push(chunk);
      }

      const last = chunks[chunks.length - 1];
      expect(last.done).toBe(true);
      expect(last.content).toBe('');
      expect(last.index).toBe(2); // two content chunks → final at index 2
    });
  });

  // ── mapError() ────────────────────────────────────────────────────────────

  describe('mapError()', () => {
    it('maps status 401 → auth_error, retryable: false', () => {
      const result = adapter.mapError(makeApiError(401));
      expect(result.code).toBe('auth_error');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('maps status 404 → invalid_model, statusCode 400', () => {
      const result = adapter.mapError(makeApiError(404));
      expect(result.code).toBe('invalid_model');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it('maps status 429 → rate_limit, retryable: true', () => {
      const result = adapter.mapError(makeApiError(429));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it('maps status 503 → provider_unavailable, retryable: true', () => {
      const result = adapter.mapError(makeApiError(503));
      expect(result.code).toBe('provider_unavailable');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('maps status 500 → provider_unavailable', () => {
      const result = adapter.mapError(makeApiError(500));
      expect(result.code).toBe('provider_unavailable');
      expect(result.retryable).toBe(true);
    });

    it("maps status 400 with 'context_length' in message → context_too_long", () => {
      const result = adapter.mapError(makeApiError(400, "This model's maximum context_length is 4096"));
      expect(result.code).toBe('context_too_long');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it('maps unknown error → unknown, retryable: false, statusCode 500', () => {
      const result = adapter.mapError(new Error('network timeout'));
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it('sets provider: openai on all errors', () => {
      expect(adapter.mapError(makeApiError(401)).provider).toBe('openai');
      expect(adapter.mapError(new Error('x')).provider).toBe('openai');
    });
  });

  // ── estimateTokens() ──────────────────────────────────────────────────────

  describe('estimateTokens()', () => {
    it('returns a positive number for non-empty messages', () => {
      const result = adapter.estimateTokens([
        { role: 'user', content: 'Hello, how are you today?' },
      ]);
      expect(result).toBeGreaterThan(0);
    });

    it('uses ~4 chars per token heuristic', () => {
      // 40 chars → ceil(40/4) = 10
      const result = adapter.estimateTokens([
        { role: 'user', content: 'a'.repeat(40) },
      ]);
      expect(result).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test — skipped until key is available
// ---------------------------------------------------------------------------

describe('OpenAIAdapter (integration)', () => {
  it.skip('real API call — add OPENAI_API_KEY to .env to run', async () => {
    const apiKey = process.env.OPENAI_API_KEY ?? '';
    const adapter = new OpenAIAdapter();

    const request: GatewayRequest = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'Reply with exactly three words: hello world test' },
      ],
      maxTokens: 20,
      tenantId: 'integration-test',
    };

    const result = await adapter.complete(request, apiKey);

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.provider).toBe('openai');
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.promptTokens + result.completionTokens);

    console.log('[integration] OpenAI response:', JSON.stringify(result, null, 2));
  });
});
