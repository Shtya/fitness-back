import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { FbEngagementCryptoService } from './fb-engagement-crypto.service';

const service = (values: Record<string, string | undefined>) =>
	new FbEngagementCryptoService({ get: (key: string) => values[key] } as unknown as ConfigService);

describe('FbEngagementCryptoService', () => {
	it('round-trips with a dedicated key and produces a fresh IV each time', () => {
		const crypto = service({ FB_ENGAGEMENT_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
		const a = crypto.encrypt('page-token');
		const b = crypto.encrypt('page-token');
		expect(a).not.toBe(b);
		expect(crypto.decrypt(a)).toBe('page-token');
	});

	it('derives a key from JWT_SECRET when no dedicated key is set', () => {
		const crypto = service({ JWT_SECRET: 'unit-test-secret' });
		expect(crypto.decrypt(crypto.encrypt('x'))).toBe('x');
	});

	it('refuses to run without any key material', () => {
		expect(() => service({}).encrypt('x')).toThrow('must be configured');
	});

	it('rejects tampered ciphertext', () => {
		const crypto = service({ JWT_SECRET: 'unit-test-secret' });
		const payload = Buffer.from(crypto.encrypt('secret'), 'base64');
		payload[payload.length - 1] ^= 0xff;
		expect(() => crypto.decrypt(payload.toString('base64'))).toThrow();
	});
});
