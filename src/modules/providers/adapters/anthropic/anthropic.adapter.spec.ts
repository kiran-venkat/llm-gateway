import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { AnthropicAdapter } from './anthropic.adapter';
import { GatewayRequest } from '../../../../common/dto/gateway-request.dto';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK constructor
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const actual = jest.requireActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
  return {
    ...actual,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate, stream: mockStream },
    })),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'hello world test', citations: null }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 3,
    } as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

function makeApiError(status: number, message = 'err'): APIError {
  return new APIError(status, undefined, message, new Headers());
}

// ---------------------------------------------------------------------------
// Unit tests — mocked SDK
// ---------------------------------------------------------------------------

describe('AnthropicAdapter (unit)', () => {
  let adapter: AnthropicAdapter;
  const FAKE_KEY = 'sk-ant-test';

  beforeEach(() => {
    adapter = new AnthropicAdapter();
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  // ── complete() ────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('translates system message to top-level param, not in messages[]', async () => {
      let capturedArgs: Anthropic.MessageCreateParamsNonStreaming | undefined;
      mockCreate.mockImplementation(async (args: Anthropic.MessageCreateParamsNonStreaming) => {
        capturedArgs = args;
        return makeMessage();
      });

      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        tenantId: 'tenant-1',
      };

      await adapter.complete(request, FAKE_KEY);

      expect(capturedArgs?.system).toBe('You are a helpful assistant.');
      expect(capturedArgs?.messages).toHaveLength(1);
      expect(capturedArgs?.messages[0].role).toBe('user');
    });

    it('maps input_tokens → promptTokens and output_tokens → completionTokens', async () => {
      mockCreate.mockResolvedValue(
        makeMessage({ usage: { input_tokens: 42, output_tokens: 7 } as Anthropic.Usage }),
      );

      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);

      expect(result.promptTokens).toBe(42);
      expect(result.completionTokens).toBe(7);
      expect(result.totalTokens).toBe(49);
    });

    it("maps stop_reason 'end_turn' → finishReason 'stop'", async () => {
      mockCreate.mockResolvedValue(makeMessage({ stop_reason: 'end_turn' }));

      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);
      expect(result.finishReason).toBe('stop');
    });

    it("maps stop_reason 'max_tokens' → finishReason 'length'", async () => {
      mockCreate.mockResolvedValue(makeMessage({ stop_reason: 'max_tokens' }));

      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);
      expect(result.finishReason).toBe('length');
    });
  });

  // ── completeStream() ──────────────────────────────────────────────────────

  describe('completeStream()', () => {
    async function* fakeStream(): AsyncIterable<Anthropic.MessageStreamEvent> {
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      };
    }

    beforeEach(() => {
      mockStream.mockReturnValue({ [Symbol.asyncIterator]: fakeStream });
    });

    it('yields correct StreamChunks for each text_delta event', async () => {
      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const chunks = [];
      for await (const chunk of adapter.completeStream(request, FAKE_KEY)) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual({ content: 'hello', index: 0, done: false });
      expect(chunks[1]).toEqual({ content: ' world', index: 1, done: false });
    });

    it('final chunk has done: true, empty content, and correct index', async () => {
      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
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
      expect(last.index).toBe(2); // two text_delta events → final at index 2
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

    it('maps status 529 → provider_unavailable, statusCode 503', () => {
      const result = adapter.mapError(makeApiError(529));
      expect(result.code).toBe('provider_unavailable');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it("maps status 400 with 'context' in message → context_too_long", () => {
      const result = adapter.mapError(makeApiError(400, 'context window exceeded'));
      expect(result.code).toBe('context_too_long');
      expect(result.retryable).toBe(false);
    });

    it('maps unknown error → unknown, retryable: false, statusCode 500', () => {
      const result = adapter.mapError(new Error('something went wrong'));
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it('sets provider: anthropic on all errors', () => {
      expect(adapter.mapError(makeApiError(401)).provider).toBe('anthropic');
      expect(adapter.mapError(new Error('x')).provider).toBe('anthropic');
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

    it('returns 0 for empty messages array', () => {
      expect(adapter.estimateTokens([])).toBe(0);
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
// Integration test — real API, skip if key absent
// ---------------------------------------------------------------------------

describe('AnthropicAdapter (integration)', () => {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const runTest = apiKey ? it : it.skip;

  runTest(
    'complete() returns real content and token counts',
    async () => {
      // Bypass the module-level mock for integration tests
      jest.unmock('@anthropic-ai/sdk');
      jest.resetModules();

      const { AnthropicAdapter: RealAdapter } =
        await import('./anthropic.adapter');
      const adapter = new RealAdapter();

      const request: GatewayRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [
          { role: 'user', content: 'Reply with exactly three words: hello world test' },
        ],
        maxTokens: 20,
        tenantId: 'integration-test',
      };

      const result = await adapter.complete(request, apiKey);

      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.provider).toBe('anthropic');
      expect(result.promptTokens).toBeGreaterThan(0);
      expect(result.completionTokens).toBeGreaterThan(0);
      expect(result.totalTokens).toBe(result.promptTokens + result.completionTokens);
      expect(['stop', 'length']).toContain(result.finishReason);

      console.log('[integration] Anthropic response:', JSON.stringify(result, null, 2));
    },
    15_000,
  );
});
