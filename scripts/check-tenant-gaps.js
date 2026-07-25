const { Client } = require('pg');
require('dotenv').config();

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

  const fk = await c.query(`
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'users'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'tenantId'
  `);
  console.log('USER_TENANT_FK', fk.rows);

  const lic = await c.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT("licenseKeyHash")::int AS with_license
    FROM tenants
  `);
  console.log('LICENSES', lic.rows[0]);

  const def = await c.query(`
    SELECT t.slug, b."appName", b."primaryColor", b."brandingVersion"
    FROM tenants t
    JOIN tenant_branding b ON b."tenantId" = t.id
    WHERE t.slug = 'so7bafit'
  `);
  console.log('DEFAULT_BRAND', def.rows[0]);

  const tablesMissingTenant = await c.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('adminId', 'owner_admin_id', 'tenantAdminId')
      AND table_name NOT IN (
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'tenantId' AND table_schema = 'public'
      )
    ORDER BY table_name
  `);
  console.log('TABLES_WITH_ADMIN_BUT_NO_TENANTID', tablesMissingTenant.rows.map(r => r.table_name));

  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
