const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  throw new Error('Missing .env at ' + envPath);
}
require('dotenv').config({ path: envPath });

(async () => {
  const password = process.env.DATABASE_PASSWORD;
  if (typeof password !== 'string' || !password) {
    throw new Error('DATABASE_PASSWORD missing from .env');
  }

  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const orphan = await client.query(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'IDX_eccb6566bdf4b40b7e5c47350e'
  `);
  console.log('orphan index', orphan.rows);

  // Drop only the known conflicting auto-named index if present
  await client.query('DROP INDEX IF EXISTS "IDX_eccb6566bdf4b40b7e5c47350e"');

  // Recreate phone-intel tables cleanly via CASCADE drops
  await client.query('DROP TABLE IF EXISTS public_matches CASCADE');
  await client.query('DROP TABLE IF EXISTS phone_reports CASCADE');
  await client.query('DROP TABLE IF EXISTS phone_lookups CASCADE');
  await client.query('DROP TABLE IF EXISTS phone_intelligence_credentials CASCADE');
  await client.query('DROP TYPE IF EXISTS phone_reports_category_enum CASCADE');
  await client.query('DROP TYPE IF EXISTS public_matches_source_type_enum CASCADE');

  const leftover = await client.query(`
    SELECT c.relkind, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        c.relname = 'IDX_eccb6566bdf4b40b7e5c47350e'
        OR c.relname IN ('phone_lookups','phone_reports','public_matches','phone_intelligence_credentials')
      )
    ORDER BY 2
  `);
  console.log('leftover', leftover.rows);
  await client.end();
  console.log('OK — restart the Nest backend so TypeORM synchronize recreates the tables');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
