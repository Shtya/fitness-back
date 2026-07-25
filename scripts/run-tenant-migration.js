const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('CONNECTED');

    const sqlPath = path.join(__dirname, '..', 'migrations', '20260724_multi_tenant_white_label.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log('MIGRATION_OK');

    const checks = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_name = 'tenants') AS tenants_table,
        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_name = 'tenant_branding') AS branding_table,
        (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'tenantId') AS users_tenant_col,
        (SELECT COUNT(*)::int FROM tenants) AS tenants_count,
        (SELECT COUNT(*)::int FROM tenant_branding) AS branding_count,
        (SELECT COUNT(*)::int FROM users WHERE "tenantId" IS NULL) AS users_without_tenant,
        (SELECT COUNT(*)::int FROM users WHERE "tenantId" IS NOT NULL) AS users_with_tenant,
        (SELECT COUNT(*)::int FROM users WHERE role = 'admin') AS admin_users
    `);
    console.log('CHECKS', JSON.stringify(checks.rows[0], null, 2));

    const tenants = await client.query(
      'SELECT id, name, slug, status, ("ownerUserId" IS NOT NULL) AS has_owner FROM tenants ORDER BY created_at',
    );
    console.log('TENANTS', JSON.stringify(tenants.rows, null, 2));

    const sample = await client.query(
      'SELECT role, COUNT(*)::int AS c, COUNT("tenantId")::int AS with_tenant FROM users GROUP BY role ORDER BY role',
    );
    console.log('USERS_BY_ROLE', JSON.stringify(sample.rows, null, 2));

    const missingFk = await client.query(`
      SELECT COUNT(*)::int AS orphan_tenant_refs
      FROM users u
      LEFT JOIN tenants t ON t.id = u."tenantId"
      WHERE u."tenantId" IS NOT NULL AND t.id IS NULL
    `);
    console.log('ORPHANS', JSON.stringify(missingFk.rows[0], null, 2));

    const brandingGaps = await client.query(`
      SELECT COUNT(*)::int AS tenants_without_branding
      FROM tenants t
      LEFT JOIN tenant_branding b ON b."tenantId" = t.id AND b.deleted_at IS NULL
      WHERE b.id IS NULL
    `);
    console.log('BRANDING_GAPS', JSON.stringify(brandingGaps.rows[0], null, 2));
  } catch (e) {
    console.error('MIGRATION_FAIL', e.message);
    if (e.detail) console.error('DETAIL', e.detail);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
