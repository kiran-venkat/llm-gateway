import { GeminiAdapter } from './gemini.adapter';
import { GatewayRequest } from '../../../../common/dto/gateway-request.dto';

// ---------------------------------------------------------------------------
// Mock the Gemini SDK
// ---------------------------------------------------------------------------

const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      candidates: [
        {
          content: { parts: [{ text: 'hello world test' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 3,
        totalTokenCount: 13,
      },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('GeminiAdapter (unit)', () => {
  let adapter: GeminiAdapter;
  const FAKE_KEY = 'AIza-test';

  beforeEach(() => {
    adapter = new GeminiAdapter();
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  // ── complete() ────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it("maps 'assistant' role → 'model' in request to Gemini", async () => {
      let capturedContents: unknown;
      mockGenerateContent.mockImplementation(
        ({ contents }: { contents: unknown }) => {
          capturedContents = contents;
          return Promise.resolve(makeResponse());
        },
      );

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
        tenantId: 'tenant-1',
      };

      await adapter.complete(request, FAKE_KEY);

      const contents = capturedContents as Array<{
        role: string;
        parts: unknown[];
      }>;
      expect(contents[1].role).toBe('model');
      expect(contents[0].role).toBe('user');
    });

    it('prepends system message to first user message text', async () => {
      let capturedContents: unknown;
      mockGenerateContent.mockImplementation(
        ({ contents }: { contents: unknown }) => {
          capturedContents = contents;
          return Promise.resolve(makeResponse());
        },
      );

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        tenantId: 'tenant-1',
      };

      await adapter.complete(request, FAKE_KEY);

      const contents = capturedContents as Array<{
        role: string;
        parts: [{ text: string }];
      }>;
      // System message is removed; only user message remains
      expect(contents).toHaveLength(1);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0].text).toBe(
        'You are a helpful assistant.\n\nHello',
      );
    });

    it('reads promptTokenCount from usageMetadata', async () => {
      mockGenerateContent.mockResolvedValue(
        makeResponse({
          usageMetadata: {
            promptTokenCount: 42,
            candidatesTokenCount: 7,
            totalTokenCount: 49,
          },
        }),
      );

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);

      expect(result.promptTokens).toBe(42);
      expect(result.completionTokens).toBe(7);
      expect(result.totalTokens).toBe(49);
    });

    it('echoes request.model as model (Gemini does not return model in response)', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse());

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const result = await adapter.complete(request, FAKE_KEY);
      expect(result.model).toBe('gemini-2.0-flash-001');
    });

    it("maps finishReason 'STOP' → 'stop'", async () => {
      mockGenerateContent.mockResolvedValue(makeResponse());

      const result = await adapter.complete(
        {
          model: 'gemini-2.0-flash-001',
          messages: [{ role: 'user', content: 'Hi' }],
          tenantId: 't',
        },
        FAKE_KEY,
      );
      expect(result.finishReason).toBe('stop');
    });

    it("maps finishReason 'MAX_TOKENS' → 'length'", async () => {
      mockGenerateContent.mockResolvedValue(
        makeResponse({
          candidates: [
            {
              content: { parts: [{ text: 'truncated' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
      );

      const result = await adapter.complete(
        {
          model: 'gemini-2.0-flash-001',
          messages: [{ role: 'user', content: 'Hi' }],
          tenantId: 't',
        },
        FAKE_KEY,
      );
      expect(result.finishReason).toBe('length');
    });
  });

  // ── completeStream() ──────────────────────────────────────────────────────

  describe('completeStream()', () => {
    it('skips chunks where content part is empty', async () => {
      async function* fakeStream() {
        yield { candidates: [{ content: { parts: [{ text: '' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: '' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: ' world' }] } }] };
      }

      mockGenerateContentStream.mockResolvedValue({ stream: fakeStream() });

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Hi' }],
        tenantId: 'tenant-1',
      };

      const chunks = [];
      for await (const chunk of adapter.completeStream(request, FAKE_KEY)) {
        chunks.push(chunk);
      }

      const content = chunks.filter((c) => !c.done).map((c) => c.content);
      expect(content).toEqual(['hello', ' world']);
    });

    it('final chunk has done: true and empty content', async () => {
      async function* fakeStream() {
        yield { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: ' world' }] } }] };
      }

      mockGenerateContentStream.mockResolvedValue({ stream: fakeStream() });

      const request: GatewayRequest = {
        model: 'gemini-2.0-flash-001',
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
      expect(last.index).toBe(2);
    });
  });

  // ── mapError() ────────────────────────────────────────────────────────────

  describe('mapError()', () => {
    it("maps error message containing '429' → rate_limit, retryable: true", () => {
      const result = adapter.mapError(new Error('[429 Too Many Requests]'));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
      expect(result.provider).toBe('gemini');
    });

    it("maps error message containing '401' → auth_error", () => {
      const result = adapter.mapError(new Error('[401 Unauthorized]'));
      expect(result.code).toBe('auth_error');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it("maps error message containing '404' → invalid_model", () => {
      const result = adapter.mapError(new Error('[404 Not Found]'));
      expect(result.code).toBe('invalid_model');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it("maps error message containing '503' → provider_unavailable", () => {
      const result = adapter.mapError(new Error('[503 Service Unavailable]'));
      expect(result.code).toBe('provider_unavailable');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it("maps error message containing 'context' → context_too_long", () => {
      const result = adapter.mapError(
        new Error('context window exceeded limit'),
      );
      expect(result.code).toBe('context_too_long');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it('maps unknown error → unknown, retryable: false, statusCode 500', () => {
      const result = adapter.mapError(new Error('network failure'));
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  // ── translateMessages() — alternating turn enforcement ───────────────────

  describe('translateMessages() — alternating turn enforcement', () => {
    it('inserts empty model message between two consecutive user messages', () => {
      const result = adapter.translateMessages([
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'Actually nevermind' },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'user', parts: [{ text: 'Hello' }] });
      expect(result[1]).toEqual({ role: 'model', parts: [{ text: '' }] });
      expect(result[2]).toEqual({
        role: 'user',
        parts: [{ text: 'Actually nevermind' }],
      });
    });

    it('inserts empty user message between two consecutive model messages', () => {
      const result = adapter.translateMessages([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'How can I help?' },
      ]);

      expect(result).toHaveLength(4);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('model');
      expect(result[2]).toEqual({ role: 'user', parts: [{ text: '' }] }); // filler
      expect(result[3].role).toBe('model');
    });

    it('prepends empty user message if first message is assistant/model', () => {
      const result = adapter.translateMessages([
        { role: 'assistant', content: 'I am ready.' },
        { role: 'user', content: 'Great' },
      ]);

      expect(result[0]).toEqual({ role: 'user', parts: [{ text: '' }] });
      expect(result[1].role).toBe('model');
      expect(result[2].role).toBe('user');
    });

    it('handles a well-formed alternating conversation without modification', () => {
      const result = adapter.translateMessages([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
      ]);

      expect(result).toHaveLength(3);
      expect(result.map((m) => m.role)).toEqual(['user', 'model', 'user']);
    });

    it('strips system messages before applying turn enforcement', () => {
      const result = adapter.translateMessages([
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ]);

      // System stripped; only one user message remains
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts[0].text).toBe('Be concise.\n\nHello');
    });
  });

  // ── estimateTokens() ──────────────────────────────────────────────────────

  describe('estimateTokens()', () => {
    it('uses ~4 chars per token heuristic', () => {
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

describe('GeminiAdapter (integration)', () => {
  it.skip('real API call — add working GEMINI_API_KEY to .env to run', async () => {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const adapter = new GeminiAdapter();

    const request: GatewayRequest = {
      model: 'gemini-2.0-flash-001',
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly three words: hello world test',
        },
      ],
      maxTokens: 20,
      tenantId: 'integration-test',
    };

    const result = await adapter.complete(request, apiKey);

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.provider).toBe('gemini');
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.model).toBe('gemini-2.0-flash-001');

    console.log(
      '[integration] Gemini response:',
      JSON.stringify(result, null, 2),
    );
  });
});
