import { createHmac, timingSafeEqual } from 'crypto';

export const MEDIA_TOKEN_TTL_SECONDS = 15 * 60;

type MediaTokenPayload = {
	a: string;
	u: string;
	e: number;
};

function signingSecret(): string {
	return (
		process.env.WHATSAPP_MEDIA_SIGNING_SECRET ||
		process.env.JWT_SECRET ||
		''
	);
}

function hmac(value: string): string {
	const secret = signingSecret();
	if (!secret) throw new Error('WhatsApp media signing secret is not configured');
	return createHmac('sha256', secret).update(value).digest('base64url');
}

function signaturesMatch(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function signMediaToken(
	attachmentId: string,
	userId: string,
	ttlSeconds = MEDIA_TOKEN_TTL_SECONDS,
	nowMs = Date.now(),
): { token: string; expiresAt: string; expiresAtMs: number } {
	const id = String(attachmentId || '').trim();
	const uid = String(userId || '').trim();
	if (!id || !uid) throw new Error('attachmentId and userId are required');
	const expiresAtMs = nowMs + Math.max(30, Number(ttlSeconds) || MEDIA_TOKEN_TTL_SECONDS) * 1000;
	const payload: MediaTokenPayload = {
		a: id,
		u: uid,
		e: Math.floor(expiresAtMs / 1000),
	};
	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const token = `v1.${body}.${hmac(body)}`;
	return { token, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs };
}

export function verifyMediaToken(
	token: string,
	attachmentId: string,
	nowMs = Date.now(),
): { userId: string; expiresAtMs: number } | null {
	const raw = String(token || '').trim();
	const expectedId = String(attachmentId || '').trim();
	const parts = raw.split('.');
	if (parts.length !== 3 || parts[0] !== 'v1' || !expectedId) return null;
	const [, body, sig] = parts;
	if (!body || !sig) return null;
	let expectedSig = '';
	try {
		expectedSig = hmac(body);
	} catch {
		return null;
	}
	if (!signaturesMatch(sig, expectedSig)) return null;
	let payload: MediaTokenPayload;
	try {
		payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (String(payload?.a || '') !== expectedId) return null;
	const userId = String(payload?.u || '').trim();
	const exp = Number(payload?.e);
	if (!userId || !Number.isFinite(exp)) return null;
	const expiresAtMs = exp * 1000;
	if (expiresAtMs <= nowMs) return null;
	return { userId, expiresAtMs };
}

export function signedMediaPath(attachmentId: string, token: string): string {
	return `/api/v1/whatsapp/attachments/${encodeURIComponent(attachmentId)}/content?token=${encodeURIComponent(token)}`;
}
