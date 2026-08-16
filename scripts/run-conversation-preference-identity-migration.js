const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
	const sslHost = /supabase|neon|amazonaws/i.test(process.env.DATABASE_HOST || '');
	const client = new Client({
		host: process.env.DATABASE_HOST,
		port: Number(process.env.DATABASE_PORT || 5432),
		user: process.env.DATABASE_USER,
		password: process.env.DATABASE_PASSWORD,
		database: process.env.DATABASE_NAME,
		ssl: sslHost ? { rejectUnauthorized: false } : undefined,
	});

	try {
		await client.connect();
		const sql = fs.readFileSync(
			path.join(__dirname, '..', 'migrations', '20260816_whatsapp_conversation_preference_identity.sql'),
			'utf8',
		);
		await client.query(sql);
		const check = await client.query(`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_name = 'whatsapp_conversation_preferences'
				AND column_name IN ('account_id', 'provider_chat_id')
			ORDER BY column_name
		`);
		console.log('MIGRATION_OK', check.rows.map((row) => row.column_name).join(','));
	} catch (error) {
		console.error('MIGRATION_FAIL', error.message);
		process.exitCode = 1;
	} finally {
		await client.end();
	}
})();
