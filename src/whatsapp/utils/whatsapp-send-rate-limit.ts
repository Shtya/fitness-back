import { HttpException, HttpStatus } from '@nestjs/common';

/** Staff can burst a handful of replies; this is a flood/abuse cap, not typing UX. */
const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 40;

const windowByKey = new Map<string, number[]>();

export function assertSendRateLimit(key: string, now = Date.now()) {
	if (process.env.NODE_ENV === 'test' && process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT !== '1') {
		return;
	}
	const id = String(key || '').trim();
	if (!id) return;

	const recent = (windowByKey.get(id) || []).filter((at) => now - at < WINDOW_MS);
	if (recent.length >= MAX_IN_WINDOW) {
		throw new HttpException(
			'Too many messages. Please wait a moment before sending again.',
			HttpStatus.TOO_MANY_REQUESTS,
		);
	}

	recent.push(now);
	windowByKey.set(id, recent);

	if (windowByKey.size > 5000) {
		for (const [bucketKey, times] of windowByKey) {
			if (!times.some((at) => now - at < WINDOW_MS)) {
				windowByKey.delete(bucketKey);
			}
		}
	}
}

export function resetSendRateLimit() {
	windowByKey.clear();
}
