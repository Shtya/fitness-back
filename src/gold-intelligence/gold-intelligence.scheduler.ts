import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { GoldIngestionService } from './services/ingestion.service';
import { GoldIntelligenceService } from './services/intelligence.service';

@Injectable()
export class GoldIntelligenceScheduler {
  private readonly logger = new Logger(GoldIntelligenceScheduler.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly ingestion: GoldIngestionService,
    private readonly intelligence: GoldIntelligenceService,
  ) {}

  @Cron('2,17,32,47 * * * *')
  async pollSpot() {
    await this.safe('spot', () => this.ingestion.ingestSpot());
  }

  @Cron('8 * * * *')
  async pollMacro() {
    await this.safe('macro', async () => {
      await this.ingestion.ingestTreasury();
      await this.ingestion.ingestFred();
    });
  }

  @Cron('20 3 * * 6')
  async pollCftc() {
    await this.safe('cftc', () => this.ingestion.ingestCftc());
  }

  @Cron('11,41 * * * *')
  async pollNews() {
    await this.safe('news', () => this.ingestion.ingestNews());
  }

  @Cron('25 2 * * *')
  async pollHistory() {
    await this.safe('history', () => this.ingestion.ingestGoldHistory(24));
  }

  @Cron('5 * * * *')
  async refreshIntelligence() {
    await this.safe('intel', () => this.intelligence.intelligence(false));
  }

  private async safe(name: string, fn: () => Promise<any>) {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`${name} job failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running.delete(name);
    }
  }
}
