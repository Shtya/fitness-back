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
 * Skip linked-device getMessages when this conversation was hydrated recently
 * and already has local rows (WhatsApp Web soft-open behavior).
 */
export function shouldSkipFreshProviderSync(options: {
	mode: 'latest' | 'older';
	force?: boolean;
	localCount: number;
	lastProviderSyncAt?: Date | string | null;
	now?: number;
	freshMs?: number;
}): { skip: boolean; reason: string } {
	const {
		mode,
		force = false,
		localCount,
		lastProviderSyncAt = null,
		now = Date.now(),
		freshMs = PROVIDER_SYNC_FRESH_MS,
	} = options;
	if (mode !== 'latest') return { skip: false, reason: 'older_mode' };
	if (force) return { skip: false, reason: 'forced' };
	if (localCount <= 0) return { skip: false, reason: 'empty_thread' };
	const age = providerSyncAgeMs(lastProviderSyncAt, now);
	if (age == null) return { skip: false, reason: 'never_hydrated' };
	if (age < freshMs) return { skip: true, reason: 'fresh' };
	return { skip: false, reason: 'stale' };
}
