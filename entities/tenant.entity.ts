import {
  Entity,
  Column,
  Index,
  Unique,
  OneToOne,
  JoinColumn,
  ManyToOne,
  Relation,
} from 'typeorm';
import { CoreEntity } from './core.entity';

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TRIAL = 'trial',
  EXPIRED = 'expired',
}

@Entity('tenants')
@Unique(['slug'])
export class Tenant extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.ACTIVE })
  status!: TenantStatus;

  /** Admin user who owns this organization (maps to legacy adminId tree). */
  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  primaryDomain!: string | null;

  /** SHA-256 hex of license key (never store raw key for public lookups). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  licenseKeyHash!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  licenseKeyPrefix!: string | null;

  /**
   * Full invite/license code for admin copy-share (org discovery).
   * Only returned to ADMIN / SUPER_ADMIN of this tenant — not public.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  licenseInviteKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  licenseExpiresAt!: Date | null;

  @Column({ type: 'boolean', default: true })
  licenseActive!: boolean;

  @Column({ type: 'int', nullable: true })
  maxDevices!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  subscriptionEndsAt!: Date | null;

  @OneToOne(() => TenantBranding, b => b.tenant, { cascade: true })
  branding?: Relation<TenantBranding>;
}

export type TenantThemeMode = 'light' | 'dark' | 'system';

@Entity('tenant_branding')
@Unique(['tenantId'])
export class TenantBranding extends CoreEntity {
  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @OneToOne(() => Tenant, t => t.branding, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Relation<Tenant>;

  @Column({ type: 'varchar', length: 160, default: 'So7baFit' })
  appName!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  shortName!: string | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  tagline!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  companyName!: string | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  supportEmail!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  supportPhone!: string | null;

  @Column({ type: 'varchar', length: 400, nullable: true })
  websiteUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  logoLightUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  logoDarkUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  iconUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  splashLogoUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  loginBackgroundUrl!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  placeholderImageUrl!: string | null;

  @Column({ type: 'varchar', length: 32, default: '#2563eb' })
  primaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ffffff' })
  primaryForegroundColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#0284c7' })
  secondaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ffffff' })
  secondaryForegroundColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#0ea5e9' })
  accentColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ffffff' })
  accentForegroundColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#f8fafc' })
  backgroundColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ffffff' })
  surfaceColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ffffff' })
  cardColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#0f172a' })
  textPrimaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#475569' })
  textSecondaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#94a3b8' })
  mutedTextColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#e2e8f0' })
  borderColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#e2e8f0' })
  dividerColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#10b981' })
  successColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#f59e0b' })
  warningColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#ef4444' })
  dangerColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#3b82f6' })
  infoColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#3b82f6' })
  darkPrimaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#0b1120' })
  darkBackgroundColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#111827' })
  darkSurfaceColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#1f2937' })
  darkCardColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#f8fafc' })
  darkTextPrimaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#94a3b8' })
  darkTextSecondaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: '#334155' })
  darkBorderColor!: string;

  @Column({ type: 'varchar', length: 80, default: 'Inter' })
  fontFamily!: string;

  @Column({ type: 'varchar', length: 80, default: 'Cairo' })
  arabicFontFamily!: string;

  @Column({ type: 'int', default: 10 })
  borderRadius!: number;

  @Column({ type: 'int', default: 12 })
  buttonRadius!: number;

  @Column({ type: 'int', default: 16 })
  cardRadius!: number;

  @Column({ type: 'varchar', length: 16, default: 'system' })
  themeMode!: TenantThemeMode;

  /** Bumps on every branding update for cache invalidation. */
  @Column({ type: 'int', default: 1 })
  brandingVersion!: number;

  @Column({ type: 'jsonb', nullable: true })
  customCssJson!: Record<string, unknown> | null;

  /** Optional link to legacy gym_settings palette key (e.g. "blue"). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  paletteKey!: string | null;
}

@Entity('tenant_branding_audits')
export class TenantBrandingAudit extends CoreEntity {
  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'jsonb', nullable: true })
  beforeJson!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  afterJson!: Record<string, unknown> | null;
}

@Entity('tenant_license_attempts')
export class TenantLicenseAttempt extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  licensePrefix!: string | null;

  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reason!: string | null;
}
