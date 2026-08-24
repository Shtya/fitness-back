/** Server-side open-chat sync policy (pairs with frontend whatsapp-message-sync.js). */

export const PROVIDER_SYNC_FRESH_MS = 5 * 60_000;

export function providerSyncAgeMs(
	lastProviderSyncAt: Date | string | null | undefined,
	now = Date.now(),
): number | null {
	if (!lastProviderSyncAt) return null;
	const at = new Date(lastProviderSyncAt).getTime();
	if (!Number.isFinite(at)) return null;
	return Math.max(0, now - at);
}

/**
 * Skip linked-device getMessages when local rows already exist.
 * WhatsApp Web does not re-pull history on open; Postgres is our replica.
 * Age / 5-minute TTL must not trigger a phone pull (catch-up is live events).
 */
export function shouldSkipFreshProviderSync(options: {
	mode: 'latest' | 'older';
	force?: boolean;
	localCount: number;
	lastProviderSyncAt?: Date | string | null;
	now?: number;
	freshMs?: number;
}): { skip: boolean; reason: string } {
	const { mode, force = false, localCount } = options;
	if (mode !== 'latest') return { skip: false, reason: 'older_mode' };
	if (force) return { skip: false, reason: 'forced' };
	if (localCount <= 0) {
		// Already probed this thread (including a genuine empty chat).
		// Do not treat browser refresh as first_hydrate.
		if (providerSyncAgeMs(options.lastProviderSyncAt, options.now) != null) {
			return { skip: true, reason: 'hydrated_empty' };
		}
		return { skip: false, reason: 'empty_thread' };
	}
	return { skip: true, reason: 'local_replica' };
}
