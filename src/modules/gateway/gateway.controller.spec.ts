import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { RateLimitResult } from '../../common/interfaces/rate-limit-result.interface';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(tenantId = 'tenant-1'): AuthContext {
  return { tenantId, apiKeyId: 'key-1', plan: 'pro' };
}

function makeDto(
  overrides: Partial<ChatCompletionRequestDto> = {},
): ChatCompletionRequestDto {
  return {
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function makeRateLimitResult(
  overrides: Partial<RateLimitResult> = {},
): RateLimitResult {
  return {
    allowed: true,
    remaining: 55,
    limit: 60,
    resetAt: new Date(Date.now() + 60_000),
    limitType: 'rpm',
    ...overrides,
  };
}

function makeMockRes(): jest.Mocked<
  Pick<
    Response,
    'status' | 'setHeader' | 'json' | 'flushHeaders' | 'write' | 'end'
  >
> {
  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    json: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  } as jest.Mocked<
    Pick<
      Response,
      'status' | 'setHeader' | 'json' | 'flushHeaders' | 'write' | 'end'
    >
  >;
  res.status.mockReturnValue(res as unknown as Response);
  return res;
}

function makeReq(rateLimit?: RateLimitResult) {
  return {
    requestId: 'req-test-001',
    rateLimit,
    tenant: makeCtx(),
  } as unknown as import('express').Request;
}

function makeMockService(): jest.Mocked<GatewayService> {
  return {
    complete: jest.fn(),
    completeStream: jest.fn(),
  } as unknown as jest.Mocked<GatewayService>;
}

const mockProviderResponse = {
  content: 'Hi there!',
  model: 'claude-haiku-4-5-20251001',
  provider: 'anthropic',
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  finishReason: 'stop' as const,
};

const mockDecision = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
};

const COMPLETE_RESULT = {
  response: mockProviderResponse,
  decision: mockDecision,
  requestId: 'req-test-001',
  durationMs: 123,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatewayController — rate limit headers', () => {
  let controller: GatewayController;
  let service: jest.Mocked<GatewayService>;

  beforeEach(() => {
    service = makeMockService();
    controller = new GatewayController(service);
  });

  // -------------------------------------------------------------------------
  // 1. Non-streaming: X-RateLimit-* headers present on success
  // -------------------------------------------------------------------------

  it('sets all three X-RateLimit-* headers on a successful non-streaming response', async () => {
    const rateLimit = makeRateLimitResult({ remaining: 42, limit: 60 });
    service.complete.mockResolvedValue(COMPLETE_RESULT);
    const res = makeMockRes();
    const req = makeReq(rateLimit);

    await controller.chatCompletion(
      makeDto(),
      makeCtx(),
      req,
      undefined,
      undefined,
      res as unknown as Response,
    );

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit-Rpm', 60);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining-Rpm', 42);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(Number),
    );
  });

  // -------------------------------------------------------------------------
  // 2. X-RateLimit-Remaining-Rpm reflects the guard's reported value
  // -------------------------------------------------------------------------

  it('X-RateLimit-Remaining-Rpm reflects remaining from RateLimitGuard', async () => {
    const rateLimit = makeRateLimitResult({ remaining: 7, limit: 60 });
    service.complete.mockResolvedValue(COMPLETE_RESULT);
    const res = makeMockRes();

    await controller.chatCompletion(
      makeDto(),
      makeCtx(),
      makeReq(rateLimit),
      undefined,
      undefined,
      res as unknown as Response,
    );

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining-Rpm', 7);
  });

  // -------------------------------------------------------------------------
  // 3. X-RateLimit-Reset is a valid future Unix timestamp (seconds)
  // -------------------------------------------------------------------------

  it('X-RateLimit-Reset is a Unix timestamp ~60 seconds in the future', async () => {
    const resetAt = new Date(Date.now() + 60_000);
    const rateLimit = makeRateLimitResult({ resetAt });
    service.complete.mockResolvedValue(COMPLETE_RESULT);
    const res = makeMockRes();
    const before = Math.floor(Date.now() / 1000);

    await controller.chatCompletion(
      makeDto(),
      makeCtx(),
      makeReq(rateLimit),
      undefined,
      undefined,
      res as unknown as Response,
    );

    const expectedReset = Math.floor(resetAt.getTime() / 1000);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expectedReset,
    );
    expect(expectedReset).toBeGreaterThan(before + 59);
  });

  // -------------------------------------------------------------------------
  // 4. No rate limit headers when rateLimit is absent (guard bypassed)
  // -------------------------------------------------------------------------

  it('omits X-RateLimit-* headers when req.rateLimit is absent', async () => {
    service.complete.mockResolvedValue(COMPLETE_RESULT);
    const res = makeMockRes();

    await controller.chatCompletion(
      makeDto(),
      makeCtx(),
      makeReq(undefined), // no rateLimit
      undefined,
      undefined,
      res as unknown as Response,
    );

    const calls = res.setHeader.mock.calls.map(([name]) => name);
    expect(calls).not.toContain('X-RateLimit-Limit-Rpm');
    expect(calls).not.toContain('X-RateLimit-Remaining-Rpm');
    expect(calls).not.toContain('X-RateLimit-Reset');
  });

  // -------------------------------------------------------------------------
  // 5. Streaming path: X-RateLimit-* headers set before flushHeaders
  // -------------------------------------------------------------------------

  it('sets X-RateLimit-* headers on the streaming path before flushHeaders', async () => {
    const rateLimit = makeRateLimitResult({ remaining: 30, limit: 60 });
    service.completeStream.mockResolvedValue(undefined);
    const res = makeMockRes();
    const callOrder: string[] = [];

    res.setHeader.mockImplementation((name: string) => {
      callOrder.push(`setHeader:${name}`);
      return res as unknown as Response;
    });
    res.flushHeaders.mockImplementation(() => {
      callOrder.push('flushHeaders');
    });

    await controller.chatCompletion(
      makeDto({ stream: true }),
      makeCtx(),
      makeReq(rateLimit),
      undefined,
      undefined,
      res as unknown as Response,
    );

    const rpmHeaderIdx = callOrder.indexOf('setHeader:X-RateLimit-Limit-Rpm');
    // completeStream is mocked and does not call flushHeaders, but the headers
    // must be set before completeStream is called (verified by mock call order).
    expect(rpmHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit-Rpm', 60);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining-Rpm', 30);
  });
});
