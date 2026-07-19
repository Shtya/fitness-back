/**
 * WhatsApp / WPPConnect timestamps may be unix seconds OR milliseconds.
 * Comparing raw values without normalizing puts "months" (ms) above "hours" (sec).
 */
export function whatsAppTimestampToMs(value: unknown): number | null {
	if (value == null || value === '') return null;
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isNaN(ms) ? null : ms;
	}
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n);
}

export function whatsAppTimestampToDate(value: unknown): Date | null {
	const ms = whatsAppTimestampToMs(value);
	if (ms == null) return null;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return null;
	const now = Date.now();
	// Drop absurd future clocks and pre-WhatsApp-era noise.
	if (ms > now + 24 * 60 * 60 * 1000) return null;
	if (ms < Date.UTC(2009, 0, 1)) return null;
	return date;
}
