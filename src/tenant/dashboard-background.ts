import { BadRequestException } from '@nestjs/common';

export const DASHBOARD_BACKGROUND_PRESETS = ['main-1', 'main-2', 'main-3'] as const;
export const DASHBOARD_BACKGROUND_KINDS = ['default', 'preset', 'gradient', 'image'] as const;

export type DashboardBackgroundKind = (typeof DASHBOARD_BACKGROUND_KINDS)[number];

export interface DashboardBackground {
  kind: Exclude<DashboardBackgroundKind, 'default'>;
  value: string;
}

/** Gradients are defined by the frontend; only the id is stored. */
const GRADIENT_ID_RE = /^[a-z0-9-]{1,40}$/;
/** Only files uploaded through the appearance endpoint, so the value is safe inside CSS url(). */
const UPLOADED_IMAGE_RE = /^\/uploads\/branding\/[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif)$/;

/** Uploaded images the super admin added to the shared "Images" list. */
export interface DashboardGalleryImage {
  id: string;
  url: string;
  createdAt: string;
}

export const DASHBOARD_GALLERY_MAX = 24;

export function isUploadedBackgroundUrl(value: unknown): value is string {
  return typeof value === 'string' && UPLOADED_IMAGE_RE.test(value);
}

export function sanitizeGallery(value: unknown): DashboardGalleryImage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: DashboardGalleryImage[] = [];
  for (const item of value) {
    const id = String(item?.id || '');
    const url = item?.url;
    if (!id || !isUploadedBackgroundUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ id, url, createdAt: String(item?.createdAt || '') });
  }
  return out;
}

/** `null` means "use the built-in default background". */
export function normalizeDashboardBackground(input: {
  kind?: string | null;
  value?: string | null;
}): DashboardBackground | null {
  const kind = String(input?.kind || '').trim();
  const value = String(input?.value || '').trim();
  if (kind === 'default') return null;
  if (kind === 'preset') {
    if (!(DASHBOARD_BACKGROUND_PRESETS as readonly string[]).includes(value)) {
      throw new BadRequestException('Unknown background preset');
    }
    return { kind, value };
  }
  if (kind === 'gradient') {
    if (!GRADIENT_ID_RE.test(value)) throw new BadRequestException('Unknown background gradient');
    return { kind, value };
  }
  if (kind === 'image') {
    if (!UPLOADED_IMAGE_RE.test(value)) throw new BadRequestException('Invalid background image');
    return { kind, value };
  }
  throw new BadRequestException('Invalid background kind');
}
