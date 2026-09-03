/**
 * Local/dev repair: DB rows marked downloaded whose files are missing on disk
 * (common after DB restore without copying uploads/). Safe for production too —
 * only flips status when the file is actually absent.
 *
 * Usage (from backend/):
 *   node scripts/reconcile-whatsapp-media-disk.mjs
 *   node scripts/reconcile-whatsapp-media-disk.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const env = Object.fromEntries(
	fs
		.readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split(/\r?\n/)
		.filter(line => line && !line.trim().startsWith('#') && line.includes('='))
		.map(line => {
			const i = line.indexOf('=');
			return [
				line.slice(0, i).trim(),
				line
					.slice(i + 1)
					.trim()
					.replace(/^["']|["']$/g, ''),
			];
		}),
);

const client = new pg.Client({
	host: env.DATABASE_HOST,
	port: Number(env.DATABASE_PORT || 5432),
	user: env.DATABASE_USER || env.DATABASE_USERNAME,
	password: env.DATABASE_PASSWORD,
	database: env.DATABASE_NAME || env.DATABASE_DATABASE,
});

await client.connect();

const { rows } = await client.query(`
	SELECT id, storage_path AS "storagePath", download_status AS "downloadStatus"
	FROM whatsapp_message_attachments
	WHERE download_status IN ('downloaded', 'downloading')
`);

const missingIds = [];
let onDisk = 0;
for (const row of rows) {
	const storagePath = String(row.storagePath || '').replace(/^\/+/, '');
	if (!storagePath) {
		missingIds.push(row.id);
		continue;
	}
	const abs = path.resolve(process.cwd(), storagePath);
	try {
		if (fs.statSync(abs).isFile()) {
			onDisk += 1;
			continue;
		}
	} catch {
		/* missing */
	}
	missingIds.push(row.id);
}

console.log(
	JSON.stringify(
		{
			scanned: rows.length,
			onDisk,
			missingOrEmpty: missingIds.length,
			apply,
		},
		null,
		2,
	),
);

if (apply && missingIds.length) {
	const chunk = 500;
	let updated = 0;
	for (let i = 0; i < missingIds.length; i += chunk) {
		const slice = missingIds.slice(i, i + chunk);
		const result = await client.query(
			`
			UPDATE whatsapp_message_attachments
			SET download_status = 'pending',
			    storage_path = NULL,
			    updated_at = NOW()
			WHERE id = ANY($1::uuid[])
			`,
			[slice],
		);
		updated += result.rowCount || 0;
	}
	console.log(JSON.stringify({ updated }, null, 2));
} else if (!apply && missingIds.length) {
	console.log('Dry run only. Re-run with --apply to reset missing rows to pending.');
}

await client.end();
