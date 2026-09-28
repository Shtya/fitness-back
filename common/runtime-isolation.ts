import { isLocalDatabaseHost } from './database-schema-sync';

function enabledByDefault(value: string | undefined) {
	return String(value ?? '').trim().toLowerCase() !== 'false';
}

/**
 * A WhatsApp identity supports one linked-device socket. A second backend (a
 * developer machine) that restores the same account kicks production off with
 * `conflict/replaced` and writes its own `qr_pending` into the shared DB.
 */
export function whatsappSessionsEnabled(env: NodeJS.ProcessEnv = process.env) {
	return enabledByDefault(env.WHATSAPP_SESSIONS_ENABLED);
}

/** Cron jobs send real notifications, emails and scheduled WhatsApp messages. */
export function backgroundJobsEnabled(env: NodeJS.ProcessEnv = process.env) {
	return enabledByDefault(env.BACKGROUND_JOBS_ENABLED);
}

export function sharedDatabaseWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
	if (env.NODE_ENV === 'production' || isLocalDatabaseHost(env.DATABASE_HOST)) return [];
	const warnings: string[] = [];
	if (whatsappSessionsEnabled(env)) {
		warnings.push(
			'WhatsApp sessions are enabled against a remote database. Set WHATSAPP_SESSIONS_ENABLED=false on developer machines that share the production DB.',
		);
	}
	if (backgroundJobsEnabled(env)) {
		warnings.push(
			'Background jobs are enabled against a remote database. Set BACKGROUND_JOBS_ENABLED=false on developer machines that share the production DB.',
		);
	}
	return warnings;
}
