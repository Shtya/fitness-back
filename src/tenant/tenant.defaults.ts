import { createHash, randomBytes } from 'crypto';

/** Safe fallback branding when tenant has no custom values. */
export const DEFAULT_BRANDING = {
  appName: 'So7baFit',
  shortName: 'So7ba',
  tagline: 'Train smarter. Live stronger.',
  companyName: 'So7baFit',
  supportEmail: null as string | null,
  supportPhone: null as string | null,
  websiteUrl: null as string | null,
  logoLightUrl: null as string | null,
  logoDarkUrl: null as string | null,
  iconUrl: null as string | null,
  splashLogoUrl: null as string | null,
  loginBackgroundUrl: null as string | null,
  placeholderImageUrl: null as string | null,
  primaryColor: '#2563eb',
  primaryForegroundColor: '#ffffff',
  secondaryColor: '#0284c7',
  secondaryForegroundColor: '#ffffff',
  accentColor: '#0ea5e9',
  accentForegroundColor: '#ffffff',
  backgroundColor: '#f8fafc',
  surfaceColor: '#ffffff',
  cardColor: '#ffffff',
  textPrimaryColor: '#0f172a',
  textSecondaryColor: '#475569',
  mutedTextColor: '#94a3b8',
  borderColor: '#e2e8f0',
  dividerColor: '#e2e8f0',
  successColor: '#10b981',
  warningColor: '#f59e0b',
  dangerColor: '#ef4444',
  infoColor: '#3b82f6',
  darkPrimaryColor: '#3b82f6',
  darkBackgroundColor: '#0b1120',
  darkSurfaceColor: '#111827',
  darkCardColor: '#1f2937',
  darkTextPrimaryColor: '#f8fafc',
  darkTextSecondaryColor: '#94a3b8',
  darkBorderColor: '#334155',
  fontFamily: 'Inter',
  arabicFontFamily: 'Cairo',
  borderRadius: 10,
  buttonRadius: 12,
  cardRadius: 16,
  themeMode: 'system' as const,
  brandingVersion: 1,
  customCssJson: null as Record<string, unknown> | null,
  paletteKey: 'blue' as string | null,
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isValidHexColor(value: string): boolean {
  return HEX_RE.test((value || '').trim());
}

export function hashLicenseKey(raw: string): string {
  return createHash('sha256').update(String(raw).trim().toUpperCase()).digest('hex');
}

export function generateLicenseKey(): { raw: string; hash: string; prefix: string } {
  const raw = `SF-${randomBytes(3).toString('hex').toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  return { raw, hash: hashLicenseKey(raw), prefix: raw.slice(0, 8) };
}

export function slugifyTenant(input: string): string {
  return String(input || 'org')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'org';
}

export function mergeBranding<T extends Record<string, any>>(row?: T | null) {
  const base = { ...DEFAULT_BRANDING };
  if (!row) return { ...base, brandingVersion: 1 };
  const out: any = { ...base };
  for (const key of Object.keys(base)) {
    const v = (row as any)[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  }
  out.brandingVersion = Number(row.brandingVersion || 1);
  out.id = (row as any).id;
  out.tenantId = (row as any).tenantId;
  out.updatedAt = (row as any).updated_at || (row as any).updatedAt;
  return out;
}

export function publicBrandingPayload(branding: ReturnType<typeof mergeBranding>, tenant: { id: string; name: string; slug: string; status: string }) {
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
    },
    branding: {
      appName: branding.appName,
      shortName: branding.shortName,
      tagline: branding.tagline,
      companyName: branding.companyName,
      supportEmail: branding.supportEmail,
      supportPhone: branding.supportPhone,
      websiteUrl: branding.websiteUrl,
      logoLightUrl: branding.logoLightUrl,
      logoDarkUrl: branding.logoDarkUrl,
      iconUrl: branding.iconUrl,
      splashLogoUrl: branding.splashLogoUrl,
      loginBackgroundUrl: branding.loginBackgroundUrl,
      placeholderImageUrl: branding.placeholderImageUrl,
      colors: {
        primary: branding.primaryColor,
        primaryForeground: branding.primaryForegroundColor,
        secondary: branding.secondaryColor,
        secondaryForeground: branding.secondaryForegroundColor,
        accent: branding.accentColor,
        accentForeground: branding.accentForegroundColor,
        background: branding.backgroundColor,
        surface: branding.surfaceColor,
        card: branding.cardColor,
        textPrimary: branding.textPrimaryColor,
        textSecondary: branding.textSecondaryColor,
        mutedText: branding.mutedTextColor,
        border: branding.borderColor,
        divider: branding.dividerColor,
        success: branding.successColor,
        warning: branding.warningColor,
        danger: branding.dangerColor,
        info: branding.infoColor,
        darkPrimary: branding.darkPrimaryColor,
        darkBackground: branding.darkBackgroundColor,
        darkSurface: branding.darkSurfaceColor,
        darkCard: branding.darkCardColor,
        darkTextPrimary: branding.darkTextPrimaryColor,
        darkTextSecondary: branding.darkTextSecondaryColor,
        darkBorder: branding.darkBorderColor,
      },
      radius: {
        border: branding.borderRadius,
        button: branding.buttonRadius,
        card: branding.cardRadius,
      },
      typography: {
        fontFamily: branding.fontFamily,
        arabicFontFamily: branding.arabicFontFamily,
      },
      themeMode: branding.themeMode,
      paletteKey: branding.paletteKey,
      brandingVersion: branding.brandingVersion,
      updatedAt: branding.updatedAt,
    },
  };
}
