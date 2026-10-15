import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { DataSource } from 'typeorm';
import {
  DASHBOARD_GALLERY_MAX,
  DashboardBackground,
  DashboardGalleryImage,
  DashboardOverlay,
  normalizeDashboardBackground,
  normalizeDashboardOverlay,
  sanitizeGallery,
} from './dashboard-background';

const DASHBOARD_BACKGROUND_KEY = 'appearance.dashboard_background';
const DASHBOARD_GALLERY_KEY = 'appearance.dashboard_background_gallery';
const DASHBOARD_OVERLAY_KEY = 'appearance.dashboard_overlay';

const PLATFORM_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS platform_settings (
  key varchar(120) PRIMARY KEY,
  value jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

export interface DashboardAppearance {
  background: DashboardBackground | null;
  gallery: DashboardGalleryImage[];
  overlay: DashboardOverlay | null;
}

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

  private async readSetting(key: string): Promise<any> {
    await this.ensureSchema();
    const rows: Array<{ value: any }> = await this.dataSource.query(
      'SELECT value FROM platform_settings WHERE key = $1',
      [key],
    );
    return rows?.[0]?.value ?? null;
  }

  private async writeSetting(key: string, value: unknown, actorUserId?: string | null) {
    await this.ensureSchema();
    if (value == null) {
      await this.dataSource.query('DELETE FROM platform_settings WHERE key = $1', [key]);
      return;
    }
    await this.dataSource.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), actorUserId || null],
    );
  }

  private async readBackground(): Promise<DashboardBackground | null> {
    const stored = await this.readSetting(DASHBOARD_BACKGROUND_KEY);
    if (!stored) return null;
    try {
      return normalizeDashboardBackground(stored);
    } catch {
      return null;
    }
  }

  private async readGallery(background: DashboardBackground | null): Promise<DashboardGalleryImage[]> {
    const gallery = sanitizeGallery(await this.readSetting(DASHBOARD_GALLERY_KEY));
    // A system image saved before the gallery existed still belongs in the list.
    if (background?.kind === 'image' && !gallery.some((item) => item.url === background.value)) {
      gallery.unshift({ id: randomUUID(), url: background.value, createdAt: new Date().toISOString() });
      await this.writeSetting(DASHBOARD_GALLERY_KEY, gallery);
    }
    return gallery;
  }

  private async readOverlay(): Promise<DashboardOverlay | null> {
    const stored = await this.readSetting(DASHBOARD_OVERLAY_KEY);
    if (!stored) return null;
    try {
      return normalizeDashboardOverlay(stored);
    } catch {
      return null;
    }
  }

  async getDashboardAppearance(): Promise<DashboardAppearance> {
    const background = await this.readBackground();
    return {
      background,
      gallery: await this.readGallery(background),
      overlay: await this.readOverlay(),
    };
  }

  async setDashboardOverlay(
    actorUserId: string,
    input: { tone?: string | null; opacity?: number | null },
  ): Promise<DashboardAppearance> {
    const overlay = normalizeDashboardOverlay(input);
    await this.writeSetting(DASHBOARD_OVERLAY_KEY, overlay, actorUserId);
    const background = await this.readBackground();
    return { background, gallery: await this.readGallery(background), overlay };
  }

  async setDashboardBackground(
    actorUserId: string,
    input: { kind?: string | null; value?: string | null },
  ): Promise<DashboardAppearance> {
    const background = normalizeDashboardBackground(input);
    const gallery = await this.readGallery(await this.readBackground());
    if (background?.kind === 'image' && !gallery.some((item) => item.url === background.value)) {
      throw new BadRequestException('Image is not in the background gallery');
    }
    await this.writeSetting(DASHBOARD_BACKGROUND_KEY, background, actorUserId);
    return { background, gallery, overlay: await this.readOverlay() };
  }

  /** Adds an uploaded file to the shared Images list and makes it the system background. */
  async addGalleryImage(actorUserId: string, url: string): Promise<DashboardAppearance> {
    const background = normalizeDashboardBackground({ kind: 'image', value: url })!;
    const gallery = await this.readGallery(await this.readBackground());
    if (gallery.length >= DASHBOARD_GALLERY_MAX) {
      await this.deleteUploadedFile(url);
      throw new BadRequestException(
        `The Images list is full (${DASHBOARD_GALLERY_MAX}). Delete an image first.`,
      );
    }
    const next = [...gallery, { id: randomUUID(), url, createdAt: new Date().toISOString() }];
    await this.writeSetting(DASHBOARD_GALLERY_KEY, next, actorUserId);
    await this.writeSetting(DASHBOARD_BACKGROUND_KEY, background, actorUserId);
    return { background, gallery: next, overlay: await this.readOverlay() };
  }

  async removeGalleryImage(actorUserId: string, id: string): Promise<DashboardAppearance> {
    let background = await this.readBackground();
    const gallery = await this.readGallery(background);
    const target = gallery.find((item) => item.id === id);
    if (!target) throw new NotFoundException('Background image not found');
    const next = gallery.filter((item) => item.id !== id);
    await this.writeSetting(DASHBOARD_GALLERY_KEY, next, actorUserId);
    if (background?.kind === 'image' && background.value === target.url) {
      background = null;
      await this.writeSetting(DASHBOARD_BACKGROUND_KEY, null, actorUserId);
    }
    await this.deleteUploadedFile(target.url);
    return { background, gallery: next, overlay: await this.readOverlay() };
  }

  private async deleteUploadedFile(url: string) {
    try {
      await fs.unlink(join(process.cwd(), 'uploads', 'branding', basename(url)));
    } catch {
      /* Already gone; the list entry is what users see. */
    }
  }
}
