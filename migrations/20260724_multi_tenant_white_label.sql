-- Multi-tenant white-label foundation
-- Safe for existing production: nullable tenantId + backfill from adminId tree

BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  slug varchar(120) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  "ownerUserId" uuid NULL,
  "primaryDomain" varchar(255) NULL,
  "licenseKeyHash" varchar(128) NULL,
  "licenseKeyPrefix" varchar(32) NULL,
  "licenseExpiresAt" timestamptz NULL,
  "licenseActive" boolean NOT NULL DEFAULT true,
  "maxDevices" int NULL,
  "subscriptionEndsAt" timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_owner ON tenants ("ownerUserId") WHERE "ownerUserId" IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_license_hash ON tenants ("licenseKeyHash") WHERE "licenseKeyHash" IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "appName" varchar(160) NOT NULL DEFAULT 'So7baFit',
  "shortName" varchar(80) NULL,
  tagline varchar(240) NULL,
  "companyName" varchar(160) NULL,
  "supportEmail" varchar(240) NULL,
  "supportPhone" varchar(64) NULL,
  "websiteUrl" varchar(400) NULL,
  "logoLightUrl" varchar(600) NULL,
  "logoDarkUrl" varchar(600) NULL,
  "iconUrl" varchar(600) NULL,
  "splashLogoUrl" varchar(600) NULL,
  "loginBackgroundUrl" varchar(600) NULL,
  "placeholderImageUrl" varchar(600) NULL,
  "primaryColor" varchar(32) NOT NULL DEFAULT '#2563eb',
  "primaryForegroundColor" varchar(32) NOT NULL DEFAULT '#ffffff',
  "secondaryColor" varchar(32) NOT NULL DEFAULT '#0284c7',
  "secondaryForegroundColor" varchar(32) NOT NULL DEFAULT '#ffffff',
  "accentColor" varchar(32) NOT NULL DEFAULT '#0ea5e9',
  "accentForegroundColor" varchar(32) NOT NULL DEFAULT '#ffffff',
  "backgroundColor" varchar(32) NOT NULL DEFAULT '#f8fafc',
  "surfaceColor" varchar(32) NOT NULL DEFAULT '#ffffff',
  "cardColor" varchar(32) NOT NULL DEFAULT '#ffffff',
  "textPrimaryColor" varchar(32) NOT NULL DEFAULT '#0f172a',
  "textSecondaryColor" varchar(32) NOT NULL DEFAULT '#475569',
  "mutedTextColor" varchar(32) NOT NULL DEFAULT '#94a3b8',
  "borderColor" varchar(32) NOT NULL DEFAULT '#e2e8f0',
  "dividerColor" varchar(32) NOT NULL DEFAULT '#e2e8f0',
  "successColor" varchar(32) NOT NULL DEFAULT '#10b981',
  "warningColor" varchar(32) NOT NULL DEFAULT '#f59e0b',
  "dangerColor" varchar(32) NOT NULL DEFAULT '#ef4444',
  "infoColor" varchar(32) NOT NULL DEFAULT '#3b82f6',
  "darkPrimaryColor" varchar(32) NOT NULL DEFAULT '#3b82f6',
  "darkBackgroundColor" varchar(32) NOT NULL DEFAULT '#0b1120',
  "darkSurfaceColor" varchar(32) NOT NULL DEFAULT '#111827',
  "darkCardColor" varchar(32) NOT NULL DEFAULT '#1f2937',
  "darkTextPrimaryColor" varchar(32) NOT NULL DEFAULT '#f8fafc',
  "darkTextSecondaryColor" varchar(32) NOT NULL DEFAULT '#94a3b8',
  "darkBorderColor" varchar(32) NOT NULL DEFAULT '#334155',
  "fontFamily" varchar(80) NOT NULL DEFAULT 'Inter',
  "arabicFontFamily" varchar(80) NOT NULL DEFAULT 'Cairo',
  "borderRadius" int NOT NULL DEFAULT 10,
  "buttonRadius" int NOT NULL DEFAULT 12,
  "cardRadius" int NOT NULL DEFAULT 16,
  "themeMode" varchar(16) NOT NULL DEFAULT 'system',
  "brandingVersion" int NOT NULL DEFAULT 1,
  "customCssJson" jsonb NULL,
  "paletteKey" varchar(40) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_branding_tenant ON tenant_branding ("tenantId") WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_branding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "actorUserId" uuid NULL,
  action varchar(64) NOT NULL,
  "beforeJson" jsonb NULL,
  "afterJson" jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS tenant_license_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip varchar(64) NULL,
  "licensePrefix" varchar(32) NULL,
  success boolean NOT NULL DEFAULT false,
  reason varchar(120) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS "tenantId" uuid NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users ("tenantId");

-- Default platform tenant
INSERT INTO tenants (id, name, slug, status, "ownerUserId")
SELECT gen_random_uuid(), 'So7baFit Default', 'so7bafit', 'active', NULL
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'so7bafit');

INSERT INTO tenant_branding ("tenantId", "appName", "shortName", tagline, "companyName", "paletteKey")
SELECT t.id, 'So7baFit', 'So7ba', 'Train smarter. Live stronger.', 'So7baFit', 'blue'
FROM tenants t
WHERE t.slug = 'so7bafit'
  AND NOT EXISTS (SELECT 1 FROM tenant_branding b WHERE b."tenantId" = t.id);

-- One tenant per existing admin
INSERT INTO tenants (name, slug, status, "ownerUserId")
SELECT
  COALESCE(NULLIF(u.name, ''), 'Organization'),
  lower(regexp_replace(COALESCE(split_part(u.email, '@', 1), u.id::text), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(u.id::text, '-', ''), 1, 8),
  'active',
  u.id
FROM users u
WHERE u.role = 'admin'
  AND u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t."ownerUserId" = u.id);

INSERT INTO tenant_branding ("tenantId", "appName", "companyName", "paletteKey")
SELECT t.id, t.name, t.name, 'blue'
FROM tenants t
WHERE t."ownerUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tenant_branding b WHERE b."tenantId" = t.id);

-- Admins → own tenant
UPDATE users u
SET "tenantId" = t.id
FROM tenants t
WHERE t."ownerUserId" = u.id
  AND u."tenantId" IS NULL;

-- Coaches/clients → admin's tenant
UPDATE users u
SET "tenantId" = t.id
FROM tenants t
WHERE u."adminId" IS NOT NULL
  AND t."ownerUserId" = u."adminId"
  AND u."tenantId" IS NULL;

-- Remaining users → default tenant
UPDATE users u
SET "tenantId" = t.id
FROM tenants t
WHERE t.slug = 'so7bafit'
  AND u."tenantId" IS NULL
  AND u.deleted_at IS NULL;

COMMIT;
