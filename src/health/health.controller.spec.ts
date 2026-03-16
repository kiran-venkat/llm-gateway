import { HttpException, HttpStatus } from '@nestjs/common';
import { Redis } from 'ioredis';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePrisma(opts: { fail?: boolean } = {}): jest.Mocked<PrismaService> {
  return {
    $queryRaw: opts.fail
      ? jest.fn().mockRejectedValue(new Error('DB connection refused'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeRedis(opts: { fail?: boolean } = {}): jest.Mocked<Pick<Redis, 'ping'>> {
  return {
    ping: opts.fail
      ? jest.fn().mockRejectedValue(new Error('Redis ECONNREFUSED'))
      : jest.fn().mockResolvedValue('PONG'),
  } as unknown as jest.Mocked<Pick<Redis, 'ping'>>;
}

function makeController(
  prismaOpts: { fail?: boolean } = {},
  redisOpts: { fail?: boolean } = {},
): HealthController {
  return new HealthController(
    makePrisma(prismaOpts),
    makeRedis(redisOpts) as unknown as Redis,
  );
}

// ---------------------------------------------------------------------------
// GET /health (liveness)
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('always returns { status: "ok" }', () => {
    const controller = makeController();
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// GET /health/ready (readiness)
// ---------------------------------------------------------------------------

describe('GET /health/ready', () => {
  it('returns 200 with status ok when both DB and Redis are healthy', async () => {
    const controller = makeController();
    const result = await controller.readiness();

    expect(result.status).toBe('ok');
    expect(result.db.status).toBe('ok');
    expect(result.redis.status).toBe('ok');
  });

  it('includes latencyMs for both checks', async () => {
    const controller = makeController();
    const result = await controller.readiness();

    expect(typeof result.db.latencyMs).toBe('number');
    expect(result.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.redis.latencyMs).toBe('number');
    expect(result.redis.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('throws 503 with degraded status when DB fails', async () => {
    const controller = makeController({ fail: true }, { fail: false });

    await expect(controller.readiness()).rejects.toThrow(HttpException);

    try {
      await controller.readiness();
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const body = ex.getResponse() as { status: string; db: { status: string }; redis: { status: string } };
      expect(body.status).toBe('degraded');
      expect(body.db.status).toBe('error');
      expect(body.redis.status).toBe('ok');
    }
  });

  it('throws 503 with degraded status when Redis fails', async () => {
    const controller = makeController({ fail: false }, { fail: true });

    await expect(controller.readiness()).rejects.toThrow(HttpException);

    try {
      await controller.readiness();
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const body = ex.getResponse() as { status: string; db: { status: string }; redis: { status: string } };
      expect(body.status).toBe('degraded');
      expect(body.db.status).toBe('ok');
      expect(body.redis.status).toBe('error');
    }
  });

  it('throws 503 when both DB and Redis fail', async () => {
    const controller = makeController({ fail: true }, { fail: true });

    await expect(controller.readiness()).rejects.toThrow(HttpException);

    try {
      await controller.readiness();
    } catch (err: unknown) {
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const body = ex.getResponse() as { status: string; db: { status: string }; redis: { status: string } };
      expect(body.db.status).toBe('error');
      expect(body.redis.status).toBe('error');
    }
  });

  it('runs DB and Redis checks in parallel (Promise.allSettled)', async () => {
    const callOrder: string[] = [];
    let dbResolve!: () => void;
    let redisResolve!: () => void;

    const prisma = {
      $queryRaw: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            dbResolve = resolve;
            callOrder.push('db-start');
          }),
      ),
    } as unknown as PrismaService;

    const redis = {
      ping: jest.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            redisResolve = () => resolve('PONG');
            callOrder.push('redis-start');
          }),
      ),
    } as unknown as Redis;

    const controller = new HealthController(prisma, redis);
    const readinessPromise = controller.readiness();

    // Both checks must have started before either resolves
    expect(callOrder).toEqual(['db-start', 'redis-start']);

    // Now resolve both
    dbResolve();
    redisResolve();
    await readinessPromise;
  });

  it('checkDb returns error result (not throw) when DB is unavailable', async () => {
    const controller = makeController({ fail: true });
    const result = await controller.checkDb();

    expect(result.status).toBe('error');
    expect(result.error).toContain('DB connection refused');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('checkRedis returns error result (not throw) when Redis is unavailable', async () => {
    const controller = makeController({}, { fail: true });
    const result = await controller.checkRedis();

    expect(result.status).toBe('error');
    expect(result.error).toContain('Redis ECONNREFUSED');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
