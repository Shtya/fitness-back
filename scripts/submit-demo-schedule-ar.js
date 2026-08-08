/**
 * One-shot: submit so7ba_demo_schedule_ar to Meta from DB credentials.
 * Usage: node scripts/submit-demo-schedule-ar.js
 */
const fs = require('fs');
const path = require('path');
const { createDecipheriv, createHash } = require('crypto');
const { Client } = require('pg');

function loadEnv(file) {
	const out = {};
	if (!fs.existsSync(file)) return out;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 0) continue;
		let v = t.slice(i + 1).trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		out[t.slice(0, i).trim()] = v;
	}
	return out;
}

function encryptionKey(env) {
	const dedicated = (env.META_WHATSAPP_ENCRYPTION_KEY || '').trim();
	if (dedicated) {
		const key = Buffer.from(dedicated, 'base64');
		if (key.length !== 32) throw new Error('META_WHATSAPP_ENCRYPTION_KEY must be 32 bytes');
		return key;
	}
	const jwtSecret = env.JWT_SECRET || 'so7bafit-dev-secret';
	return createHash('sha256')
		.update(`so7bafit:meta-whatsapp-credentials:${jwtSecret}`)
		.digest();
}

function decryptSecrets(encoded, env) {
	const payload = Buffer.from(encoded, 'base64');
	const iv = payload.subarray(0, 12);
	const tag = payload.subarray(12, 28);
	const ciphertext = payload.subarray(28);
	const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), iv);
	decipher.setAuthTag(tag);
	return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

const BODY = [
	'مرحباً {{1}} 👋',
	'',
	'حابب نرتب ميتنج ديمو سريع لـ So7baFit (حوالي 10 دقايق).',
	'',
	'اختَر ميعاد يناسبك من الأزرار تحت، أو اضغط «هكتب وقت يناسبني» واكتب اليوم والساعة اللي تفضّلها.',
	'',
	'بعد اختيارك هرد عليك فوراً لتأكيد اللينك/الموعد.',
].join('\n');

async function main() {
	const env = loadEnv(path.join(__dirname, '..', '.env'));
	const client = new Client({
		host: env.DATABASE_HOST || 'localhost',
		port: Number(env.DATABASE_PORT || 5432),
		user: env.DATABASE_USER,
		password: env.DATABASE_PASSWORD,
		database: env.DATABASE_NAME,
	});
	await client.connect();
	const { rows } = await client.query(
		`SELECT encrypted_credentials, waba_id, phone_number_id, enabled
		 FROM meta_whatsapp_config
		 ORDER BY updated_at DESC NULLS LAST
		 LIMIT 1`,
	);
	await client.end();
	if (!rows.length) throw new Error('No meta_whatsapp_config row found');
	const cfg = rows[0];
	if (!cfg.encrypted_credentials) throw new Error('No encrypted credentials saved');
	const secrets = decryptSecrets(cfg.encrypted_credentials, env);
	if (!secrets.accessToken) throw new Error('No access token in credentials');
	const wabaId = cfg.waba_id;
	if (!wabaId) throw new Error('waba_id missing — save Meta config first');
	const version = 'v21.0';

	const payload = {
		name: 'so7ba_demo_schedule_ar',
		language: 'ar',
		category: 'UTILITY',
		allow_category_change: true,
		parameter_format: 'positional',
		components: [
			{
				type: 'HEADER',
				format: 'TEXT',
				text: 'تنسيق ميتنج الديمو',
			},
			{
				type: 'BODY',
				text: BODY,
				example: { body_text: [['أحمد']] },
			},
			{
				type: 'FOOTER',
				text: 'So7baFit · تنسيق موعد',
			},
			{
				type: 'BUTTONS',
				buttons: [
					{ type: 'QUICK_REPLY', text: 'غداً 11 ص' },
					{ type: 'QUICK_REPLY', text: 'غداً 4 م' },
					{ type: 'QUICK_REPLY', text: 'هكتب وقت يناسبني' },
				],
			},
		],
	};

	const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${secrets.accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	const data = await res.json();
	if (!res.ok) {
		console.error(JSON.stringify({ ok: false, status: res.status, error: data }, null, 2));
		process.exit(1);
	}
	console.log(
		JSON.stringify(
			{
				ok: true,
				id: data.id,
				status: data.status,
				category: data.category,
				name: 'so7ba_demo_schedule_ar',
				language: 'ar',
			},
			null,
			2,
		),
	);
}

main().catch(err => {
	console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
	process.exit(1);
});
