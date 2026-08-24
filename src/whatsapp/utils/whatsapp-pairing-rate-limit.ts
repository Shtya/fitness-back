import { HttpException, HttpStatus } from '@nestjs/common';

const MIN_INTERVAL_MS = 45_000;
const WINDOW_MS = 15 * 60_000;
const MAX_IN_WINDOW = 5;

const lastByKey = new Map<string, number>();
const windowByKey = new Map<string, number[]>();

export function assertPairingCodeRateLimit(key: string, now = Date.now()) {
	const id = String(key || '').trim();
	if (!id) return;

	const last = lastByKey.get(id) || 0;
	if (last && now - last < MIN_INTERVAL_MS) {
		const waitSec = Math.ceil((MIN_INTERVAL_MS - (now - last)) / 1000);
		throw new HttpException(
			`Please wait ${waitSec}s before requesting another pairing code.`,
			HttpStatus.TOO_MANY_REQUESTS,
		);
	}

	const recent = (windowByKey.get(id) || []).filter((at) => now - at < WINDOW_MS);
	if (recent.length >= MAX_IN_WINDOW) {
		throw new HttpException(
			'Too many pairing-code requests. Try again in a few minutes.',
			HttpStatus.TOO_MANY_REQUESTS,
		);
	}

	recent.push(now);
	windowByKey.set(id, recent);
	lastByKey.set(id, now);

	if (windowByKey.size > 5000) {
		for (const [bucketKey, times] of windowByKey) {
			if (!times.some((at) => now - at < WINDOW_MS)) {
				windowByKey.delete(bucketKey);
				lastByKey.delete(bucketKey);
			}
		}
	}
}

export function resetPairingCodeRateLimit() {
	lastByKey.clear();
	windowByKey.clear();
}
