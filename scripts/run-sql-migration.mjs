import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const migrationFile = process.argv[2];

if (!migrationFile) {
	console.error('Usage: node scripts/run-sql-migration.mjs <migration-file.sql>');
	process.exit(1);
}

const envPath = path.join(root, '.env');
const env = Object.fromEntries(
	fs
		.readFileSync(envPath, 'utf8')
		.split(/\r?\n/)
		.filter(line => line && !line.startsWith('#') && line.includes('='))
		.map(line => {
			const index = line.indexOf('=');
			return [line.slice(0, index), line.slice(index + 1)];
		}),
);

const client = new pg.Client({
	host: env.DATABASE_HOST,
	port: Number(env.DATABASE_PORT),
	user: env.DATABASE_USER,
	password: env.DATABASE_PASSWORD,
	database: env.DATABASE_NAME,
	ssl: { rejectUnauthorized: false },
});

const sqlPath = path.isAbsolute(migrationFile)
	? migrationFile
	: path.join(root, migrationFile);
const sql = fs.readFileSync(sqlPath, 'utf8');

try {
	await client.connect();
	await client.query(sql);
	const result = await client.query(
		"SELECT to_regclass('public.whatsapp_message_schedules') AS table_name",
	);
	console.log('Migration OK:', result.rows[0]?.table_name || 'unknown');
} catch (error) {
	console.error('Migration failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await client.end();
}
