import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MetaWhatsAppSecrets = {
	accessToken: string;
	appSecret: string;
	verifyToken: string;
};

@Injectable()
export class MetaWhatsAppCryptoService {
	constructor(private readonly config: ConfigService) {}

	encryptionKey() {
		const dedicated = this.config.get<string>('META_WHATSAPP_ENCRYPTION_KEY')?.trim();
		if (dedicated) {
			const key = Buffer.from(dedicated, 'base64');
			if (key.length !== 32) {
				throw new Error('META_WHATSAPP_ENCRYPTION_KEY must decode to 32 bytes');
			}
			return key;
		}
		const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		return createHash('sha256')
			.update(`so7bafit:meta-whatsapp-credentials:${jwtSecret}`)
			.digest();
	}

	encryptSecrets(secrets: MetaWhatsAppSecrets): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(secrets), 'utf8'),
			cipher.final(),
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	decryptSecrets(encoded: string): MetaWhatsAppSecrets {
		const payload = Buffer.from(encoded, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return JSON.parse(
			Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
		) as MetaWhatsAppSecrets;
	}

	hashVerifyToken(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}

	verifyTokenMatches(plain: string, hash: string | null | undefined): boolean {
		if (!plain || !hash) return false;
		const a = Buffer.from(this.hashVerifyToken(plain), 'hex');
		const b = Buffer.from(hash, 'hex');
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}

	verifyMetaSignature(rawBody: Buffer | string, signatureHeader: string | undefined, appSecret: string) {
		if (!signatureHeader || !appSecret) return false;
		const expected = signatureHeader.startsWith('sha256=')
			? signatureHeader.slice('sha256='.length)
			: signatureHeader;
		const hmac = createHmac('sha256', appSecret)
			.update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
			.digest('hex');
		try {
			const a = Buffer.from(hmac, 'hex');
			const b = Buffer.from(expected, 'hex');
			if (a.length !== b.length) return false;
			return timingSafeEqual(a, b);
		} catch {
			return false;
		}
	}

	maskSecret(value: string | null | undefined): string | null {
		if (!value) return null;
		if (value.length <= 4) return '****';
		return `••••${value.slice(-4)}`;
	}
}

/** Digits-only E.164-ish id used by Cloud API (no +). */
export function normalizeWaId(phone: string | null | undefined): string | null {
	if (!phone) return null;
	let digits = String(phone).trim().replace(/\D/g, '');
	if (!digits) return null;

	// Strip international dial prefix 00…
	if (digits.startsWith('00')) digits = digits.slice(2);

	// Egypt local mobile: 01[0125]xxxxxxxx → 201[0125]xxxxxxxx
	if (/^01[0125]\d{8}$/.test(digits)) {
		digits = `20${digits.slice(1)}`;
	}

	// Still starts with 0 → missing / invalid country code
	if (digits.startsWith('0')) return null;

	// WhatsApp Cloud API expects country code + national number (E.164 without +)
	if (digits.length < 10 || digits.length > 15) return null;

	return digits;
}

export const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Prefer the newest sane timestamp (ms since epoch). Rejects epoch / pre-2000 values. */
export function bestMessageTimestamp(
	...values: Array<Date | string | number | null | undefined>
): number {
	let best = 0;
	for (const value of values) {
		if (value == null || value === '') continue;
		let ms = new Date(value).getTime();
		if (!Number.isFinite(ms)) continue;
		// Meta sometimes stores unix seconds; coerce obvious second-precision values.
		if (ms > 0 && ms < 1e11) ms *= 1000;
		// Ignore clearly broken dates (before ~Sep 2001)
		if (ms < 1e12) continue;
		if (ms > best) best = ms;
	}
	return best;
}

export function isWithinCustomerCareWindow(lastInboundAt: Date | null | undefined, now = new Date()) {
	const at = bestMessageTimestamp(lastInboundAt);
	if (!at) return false;
	return now.getTime() - at <= CUSTOMER_CARE_WINDOW_MS;
}
