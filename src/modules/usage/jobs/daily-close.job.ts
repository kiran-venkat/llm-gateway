import { Process, Processor, InjectQueue } from '@nestjs/bull';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { Job, Queue } from 'bull';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { UsageRepository } from '../usage.repository';
import { computePercentile } from '../../../common/utils/percentile.util';

interface DailyCloseJobData {
  date: string; // YYYY-MM-DD
}

@Processor('daily-close')
export class DailyCloseJob {
  private readonly logger = new AppLoggerService(DailyCloseJob.name);

  constructor(
    private readonly usageRepo: UsageRepository,
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue('daily-close') private readonly queue: Queue,
  ) {}

  /**
   * Cron trigger: 00:05 UTC every night.
   * Enqueues a 'close' job for yesterday so the actual work runs through BullMQ
   * (retryable, monitorable, manually triggerable).
   */
  @Cron('5 0 * * *')
  async schedule(): Promise<void> {
    const date = this.getYesterdayDate();
    this.logger.log('Scheduling daily close', { date });
    await this.queue.add('close', { date } satisfies DailyCloseJobData);
  }

  /**
   * BullMQ processor: reads latency sorted sets for all (tenantId, provider, model) seen
   * in usage_daily for the given date, computes p95 + avg, upserts into usage_daily,
   * then deletes the Redis key.
   *
   * Idempotent: running twice for the same date produces the same result because
   * the first run deletes the Redis keys — second run finds no samples and skips.
   */
  @Process('close')
  async process(job: Job<DailyCloseJobData>): Promise<void> {
    const { date } = job.data;
    const rows = await this.usageRepo.getUsageDailyRows(date);

    if (rows.length === 0) {
      this.logger.log('No usage_daily rows found — skipping', { date });
      return;
    }

    let updatedCount = 0;

    for (const row of rows) {
      const key = `tenant:${row.tenantId}:latency:${row.provider}:${row.model}:${date}`;
      const samples = await this.getLatencySamples(key);

      if (samples.length === 0) {
        // No latency data recorded for this row (e.g. all were cache hits) — skip silently.
        continue;
      }

      const sorted = [...samples].sort((a, b) => a - b);
      const p95 = computePercentile(sorted, 95);
      const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;

      await this.usageRepo.updateLatencyStats(
        row.tenantId,
        row.provider,
        row.model,
        date,
        Math.round(p95),
        avg,
      );

      await this.redis.del(key);
      updatedCount++;
    }

    this.logger.log('Daily close complete', { date, updatedCount });
  }

  /**
   * Reads all scores (latency values in ms) from the Redis sorted set.
   * ZRANGEBYSCORE returns [member1, score1, member2, score2, ...] — we extract scores.
   */
  private async getLatencySamples(key: string): Promise<number[]> {
    const result = await this.redis.zrangebyscore(
      key,
      '-inf',
      '+inf',
      'WITHSCORES',
    );
    const scores: number[] = [];
    for (let i = 1; i < result.length; i += 2) {
      scores.push(parseFloat(result[i]));
    }
    return scores;
  }

  private getYesterdayDate(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  }
}
