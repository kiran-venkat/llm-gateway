import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

interface CheckResult {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  db: CheckResult;
  redis: CheckResult;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Always returns 200. Confirms the process is running.',
  })
  @ApiResponse({ status: 200, description: '{ status: "ok" }' })
  @Get()
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks DB and Redis connectivity in parallel. Returns 503 if either is unreachable.',
  })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies unreachable',
  })
  @Get('ready')
  async readiness(): Promise<ReadinessResponse> {
    const [dbSettled, redisSettled] = await Promise.allSettled([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const db =
      dbSettled.status === 'fulfilled'
        ? dbSettled.value
        : {
            status: 'error' as const,
            latencyMs: 0,
            error: String((dbSettled as PromiseRejectedResult).reason),
          };
    const redis =
      redisSettled.status === 'fulfilled'
        ? redisSettled.value
        : {
            status: 'error' as const,
            latencyMs: 0,
            error: String((redisSettled as PromiseRejectedResult).reason),
          };

    const allOk = db.status === 'ok' && redis.status === 'ok';

    if (!allOk) {
      throw new HttpException(
        { status: 'degraded', db, redis } satisfies ReadinessResponse,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', db, redis };
  }

  async checkDb(): Promise<CheckResult> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async checkRedis(): Promise<CheckResult> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
