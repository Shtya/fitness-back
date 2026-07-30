const path = require('path');
require('dotenv').config({ path: path.resolve('.env') });
require('ts-node/register');
require('tsconfig-paths/register');
const { DataSource } = require('typeorm');
const ents = require('../src/phone-intelligence/entities/phone-intelligence.entity.ts');

(async () => {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
    synchronize: true,
    entities: [
      ents.PhoneLookup,
      ents.PhoneReport,
      ents.PublicMatch,
      ents.PhoneIntelligenceCredential,
    ],
  });
  await ds.initialize();
  console.log('sync OK');
  const tables = await ds.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND (
        tablename LIKE 'phone%'
        OR tablename = 'public_matches'
      )
    ORDER BY 1
  `);
  console.log(tables);
  const indexes = await ds.query(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('phone_lookups','phone_reports','public_matches','phone_intelligence_credentials')
    ORDER BY 1
  `);
  console.log(indexes);
  await ds.destroy();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
