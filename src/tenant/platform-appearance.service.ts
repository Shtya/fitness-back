import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DashboardBackground, normalizeDashboardBackground } from './dashboard-background';

const DASHBOARD_BACKGROUND_KEY = 'appearance.dashboard_background';

const PLATFORM_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS platform_settings (
  key varchar(120) PRIMARY KEY,
  value jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

/** Platform-wide settings owned by the super admin (production runs with synchronize off). */
@Injectable()
export class PlatformAppearanceService implements OnModuleInit {
  private readonly logger = new Logger(PlatformAppearanceService.name);
  private ready: Promise<void> | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit() {
    return this.ensureSchema();
  }

  private ensureSchema() {
    if (!this.ready) {
      this.ready = this.dataSource
        .query(PLATFORM_SETTINGS_SCHEMA)
        .then(() => undefined)
        .catch((error) => {
          this.logger.error(
            `Could not ensure platform_settings: ${error instanceof Error ? error.message : error}`,
          );
        });
    }
    return this.ready;
  }

  async getDashboardBackground(): Promise<{ background: DashboardBackground | null }> {
    await this.ensureSchema();
    const rows: Array<{ value: any }> = await this.dataSource.query(
      'SELECT value FROM platform_settings WHERE key = $1',
      [DASHBOARD_BACKGROUND_KEY],
    );
    const stored = rows?.[0]?.value;
    if (!stored) return { background: null };
    try {
      return { background: normalizeDashboardBackground(stored) };
    } catch {
      return { background: null };
    }
  }

  async setDashboardBackground(
    actorUserId: string,
    input: { kind?: string | null; value?: string | null },
  ): Promise<{ background: DashboardBackground | null }> {
    const background = normalizeDashboardBackground(input);
    await this.ensureSchema();
    if (!background) {
      await this.dataSource.query('DELETE FROM platform_settings WHERE key = $1', [
        DASHBOARD_BACKGROUND_KEY,
      ]);
      return { background: null };
    }
    await this.dataSource.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [DASHBOARD_BACKGROUND_KEY, JSON.stringify(background), actorUserId || null],
    );
    return { background };
  }
}
