const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config();

function hashLicenseKey(raw) {
  return crypto.createHash('sha256').update(String(raw).trim().toUpperCase()).digest('hex');
}

function generateLicenseKey() {
  const raw = `SF-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  return { raw, hash: hashLicenseKey(raw), prefix: raw.slice(0, 8) };
}

(async () => {
  const c = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  // 1) Add FK if missing
  const fk = await c.query(`
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users' AND constraint_name = 'fk_users_tenant'
  `);
  if (!fk.rowCount) {
    await c.query(`
      ALTER TABLE users
      ADD CONSTRAINT fk_users_tenant
      FOREIGN KEY ("tenantId") REFERENCES tenants(id)
      ON DELETE SET NULL
    `);
    console.log('FK_ADDED');
  } else {
    console.log('FK_ALREADY_EXISTS');
  }

  // 2) Ensure invite-key column exists
  await c.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS "licenseInviteKey" varchar(64)
  `);

  // 3) Generate licenses for tenants that don't have one
  const tenants = await c.query(`
    SELECT id, name, slug FROM tenants WHERE "licenseKeyHash" IS NULL ORDER BY created_at
  `);
  const issued = [];
  for (const t of tenants.rows) {
    const lic = generateLicenseKey();
    await c.query(
      `UPDATE tenants
       SET "licenseKeyHash" = $1, "licenseKeyPrefix" = $2, "licenseInviteKey" = $3, "licenseActive" = true, updated_at = now()
       WHERE id = $4`,
      [lic.hash, lic.prefix, lic.raw, t.id],
    );
    issued.push({ id: t.id, name: t.name, slug: t.slug, licenseKey: lic.raw });
  }
  console.log('LICENSES_ISSUED', JSON.stringify(issued, null, 2));

  // 4) Backfill invite keys for tenants that have hash but no shareable key
  const missingInvite = await c.query(`
    SELECT id, name, slug FROM tenants
    WHERE "licenseKeyHash" IS NOT NULL AND ("licenseInviteKey" IS NULL OR "licenseInviteKey" = '')
    ORDER BY created_at
  `);
  const reissued = [];
  for (const t of missingInvite.rows) {
    const lic = generateLicenseKey();
    await c.query(
      `UPDATE tenants
       SET "licenseKeyHash" = $1, "licenseKeyPrefix" = $2, "licenseInviteKey" = $3, "licenseActive" = true, updated_at = now()
       WHERE id = $4`,
      [lic.hash, lic.prefix, lic.raw, t.id],
    );
    reissued.push({ id: t.id, name: t.name, slug: t.slug, licenseKey: lic.raw });
  }
  console.log('LICENSE_INVITE_BACKFILL', JSON.stringify(reissued, null, 2));

  const verify = await c.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants WHERE "licenseKeyHash" IS NOT NULL) AS with_license,
      (SELECT COUNT(*)::int FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_tenant') AS fk_ok
  `);
  console.log('VERIFY', verify.rows[0]);

  await c.end();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
