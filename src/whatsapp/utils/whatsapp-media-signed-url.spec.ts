import {
	MEDIA_TOKEN_TTL_SECONDS,
	signMediaToken,
	signedMediaPath,
	verifyMediaToken,
} from './whatsapp-media-signed-url';

describe('whatsapp-media-signed-url', () => {
	const prevSecret = process.env.JWT_SECRET;
	const prevMedia = process.env.WHATSAPP_MEDIA_SIGNING_SECRET;

	beforeEach(() => {
		process.env.JWT_SECRET = 'test-jwt-secret-for-media';
		delete process.env.WHATSAPP_MEDIA_SIGNING_SECRET;
	});

	afterAll(() => {
		if (prevSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = prevSecret;
		if (prevMedia === undefined) delete process.env.WHATSAPP_MEDIA_SIGNING_SECRET;
		else process.env.WHATSAPP_MEDIA_SIGNING_SECRET = prevMedia;
	});

	it('round-trips a token scoped to attachment + user', () => {
		const now = 1_700_000_000_000;
		const signed = signMediaToken('att-1', 'user-9', MEDIA_TOKEN_TTL_SECONDS, now);
		expect(signed.token.startsWith('v1.')).toBe(true);
		expect(verifyMediaToken(signed.token, 'att-1', now + 1000)).toEqual({
			userId: 'user-9',
			expiresAtMs: signed.expiresAtMs,
		});
	});

	it('rejects a token for a different attachment id', () => {
		const signed = signMediaToken('att-1', 'user-9');
		expect(verifyMediaToken(signed.token, 'att-2')).toBeNull();
	});

	it('rejects an expired token', () => {
		const now = 1_700_000_000_000;
		const signed = signMediaToken('att-1', 'user-9', 60, now);
		expect(verifyMediaToken(signed.token, 'att-1', signed.expiresAtMs + 1)).toBeNull();
	});

	it('rejects a tampered signature', () => {
		const signed = signMediaToken('att-1', 'user-9');
		const [v, body] = signed.token.split('.');
		expect(verifyMediaToken(`${v}.${body}.AAAA`, 'att-1')).toBeNull();
	});

	it('builds a query-token content path the <audio> element can request', () => {
		expect(signedMediaPath('att/1', 'tok.en')).toBe(
			'/api/v1/whatsapp/attachments/att%2F1/content?token=tok.en',
		);
	});
});
