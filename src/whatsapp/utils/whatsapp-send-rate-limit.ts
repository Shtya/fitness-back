import { HttpException, HttpStatus } from '@nestjs/common';

/** Staff can burst a handful of replies; this is a flood/abuse cap, not typing UX. */
const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 40;

/**
 * Voice-edit previews spawn FFmpeg and may call a metered ElevenLabs endpoint, so
 * they get their own much tighter bucket than plain message sends.
 */
const PREVIEW_WINDOW_MS = 60_000;
const PREVIEW_MAX_IN_WINDOW = 12;

const buckets = new Map<string, Map<string, number[]>>();

function bucket(name: string) {
	let existing = buckets.get(name);
	if (!existing) {
		existing = new Map<string, number[]>();
		buckets.set(name, existing);
	}
	return existing;
}

function assertBucketLimit(
	name: string,
	key: string,
	limits: { windowMs: number; max: number; message: string },
	now: number,
) {
	if (process.env.NODE_ENV === 'test' && process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT !== '1') {
		return;
	}
	const id = String(key || '').trim();
	if (!id) return;

	const windowByKey = bucket(name);
	const recent = (windowByKey.get(id) || []).filter((at) => now - at < limits.windowMs);
	if (recent.length >= limits.max) {
		throw new HttpException(limits.message, HttpStatus.TOO_MANY_REQUESTS);
	}

	recent.push(now);
	windowByKey.set(id, recent);

	if (windowByKey.size > 5000) {
		for (const [bucketKey, times] of windowByKey) {
			if (!times.some((at) => now - at < limits.windowMs)) {
				windowByKey.delete(bucketKey);
			}
		}
	}
}

export function assertSendRateLimit(key: string, now = Date.now()) {
	assertBucketLimit(
		'send',
		key,
		{
			windowMs: WINDOW_MS,
			max: MAX_IN_WINDOW,
			message: 'Too many messages. Please wait a moment before sending again.',
		},
		now,
	);
}

export function assertVoicePreviewRateLimit(key: string, now = Date.now()) {
	assertBucketLimit(
		'voice-preview',
		key,
		{
			windowMs: PREVIEW_WINDOW_MS,
			max: PREVIEW_MAX_IN_WINDOW,
			message: 'Too many audio previews. Wait a moment before rendering another one.',
		},
		now,
	);
}

export function resetSendRateLimit() {
	buckets.clear();
}
