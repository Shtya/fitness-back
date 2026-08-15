import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PipelineService } from './services/pipeline.service';

/**
 * Server-side scheduler abstraction.
 * Current driver: NestJS cron (every minute).
 * Can later be triggered by Vercel Cron / Cloudflare Cron / GitHub Actions
 * hitting an authenticated internal endpoint without changing pipeline logic.
 */
@Injectable()
export class AiContentStudioScheduler {
  private readonly logger = new Logger(AiContentStudioScheduler.name);
  private readonly recent = new Map<string, number>();

  constructor(private readonly pipeline: PipelineService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      const due = await this.pipeline.findDueConfigs(new Date());
      for (const row of due) {
        const key = `${row.userId}:${new Date().toISOString().slice(0, 16)}`;
        if (this.recent.has(key)) continue;
        this.recent.set(key, Date.now());
        this.logger.log(`Scheduled pipeline for user ${row.userId}`);
        await this.pipeline.runPipeline(row.userId, {
          trigger: 'schedule',
          publish: Boolean(row.configJson?.autoPublish),
        });
      }
      // cleanup old keys
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      for (const [k, ts] of this.recent) {
        if (ts < cutoff) this.recent.delete(k);
      }
    } catch (e: any) {
      this.logger.error(`Scheduler tick failed: ${e?.message || e}`);
    }
  }
}
