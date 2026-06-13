import IORedisMock from 'ioredis-mock';
import { Redis } from 'ioredis';
import { RateLimitService } from './rate-limit.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-abc';
const PROVIDER = 'openai';
const RPM_LIMIT = 60;

function makeService(redis: Redis): RateLimitService {
  const svc = new RateLimitService(redis);
  svc.onModuleInit(); // load Lua script from disk
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateLimitService', () => {
  let redis: Redis;
  let service: RateLimitService;

  beforeEach(async () => {
    redis = new IORedisMock() as unknown as Redis;
    await redis.flushall();
    service = makeService(redis);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. 60 sequential requests — all allowed
  // -------------------------------------------------------------------------

  it('allows the first 60 requests within a window', async () => {
    for (let i = 0; i < RPM_LIMIT; i++) {
      const result = await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(RPM_LIMIT - i - 1);
      expect(result.limitType).toBe('rpm');
      expect(result.retryAfterMs).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // 2. 61st request — rejected
  // -------------------------------------------------------------------------

  it('rejects the 61st request and returns remaining 0', async () => {
    for (let i = 0; i < RPM_LIMIT; i++) {
      await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    }

    const result = await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(60_000);
    expect(result.limitType).toBe('rpm');
  });

  // -------------------------------------------------------------------------
  // 3. After window expires — allowed again
  // -------------------------------------------------------------------------

  it('allows requests again after the window has elapsed', async () => {
    // Fill the window.
    for (let i = 0; i < RPM_LIMIT; i++) {
      await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    }
    expect((await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT)).allowed).toBe(
      false,
    );

    // Advance Date.now() by 61 seconds so all entries fall outside the window.
    const future = Date.now() + 61_000;
    jest.spyOn(Date, 'now').mockReturnValue(future);

    const result = await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RPM_LIMIT - 1);
  });

  // -------------------------------------------------------------------------
  // 4. Concurrency with limit = 1 — only one call passes
  // -------------------------------------------------------------------------

  it('allows only one of two concurrent calls when limit is 1', async () => {
    const [first, second] = await Promise.all([
      service.checkRpm(TENANT, PROVIDER, 1),
      service.checkRpm(TENANT, PROVIDER, 1),
    ]);

    const allowedCount = [first, second].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);

    const rejectedCount = [first, second].filter((r) => !r.allowed).length;
    expect(rejectedCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 5. getRemainingRpm reflects current state correctly
  // -------------------------------------------------------------------------

  it('getRemainingRpm returns the correct remaining count', async () => {
    const initialRemaining = await service.getRemainingRpm(
      TENANT,
      PROVIDER,
      RPM_LIMIT,
    );
    expect(initialRemaining).toBe(RPM_LIMIT);

    await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);

    const remaining = await service.getRemainingRpm(
      TENANT,
      PROVIDER,
      RPM_LIMIT,
    );
    expect(remaining).toBe(RPM_LIMIT - 3);
  });

  it('getRemainingRpm returns 0 when limit is exhausted', async () => {
    for (let i = 0; i < RPM_LIMIT; i++) {
      await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    }
    const remaining = await service.getRemainingRpm(
      TENANT,
      PROVIDER,
      RPM_LIMIT,
    );
    expect(remaining).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. resetAt is approximately now + 60 seconds
  // -------------------------------------------------------------------------

  it('resetAt is ~60s in the future', async () => {
    const before = Date.now();
    const result = await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    const after = Date.now();

    expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.resetAt.getTime()).toBeLessThanOrEqual(after + 60_000);
  });

  // -------------------------------------------------------------------------
  // 7. TPM check uses a separate key from RPM
  // -------------------------------------------------------------------------

  it('checkTpm uses a separate Redis key from checkRpm', async () => {
    // Fill up the RPM bucket
    for (let i = 0; i < RPM_LIMIT; i++) {
      await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT);
    }
    expect((await service.checkRpm(TENANT, PROVIDER, RPM_LIMIT)).allowed).toBe(
      false,
    );

    // TPM bucket should still be clean
    const tpm = await service.checkTpm(TENANT, PROVIDER, 500, RPM_LIMIT);
    expect(tpm.allowed).toBe(true);
    expect(tpm.limitType).toBe('tpm');
  });

  // -------------------------------------------------------------------------
  // 8. Redis key format
  // -------------------------------------------------------------------------

  it('uses the correct Redis key format for RPM', async () => {
    const evalSpy = jest.spyOn(redis, 'eval');
    await service.checkRpm('t1', 'anthropic', 100);

    expect(evalSpy).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1,
      'ratelimit:t1:anthropic:rpm',
      expect.any(String), // now
      '60000',
      '100',
      expect.any(String), // member
    );
  });
});
