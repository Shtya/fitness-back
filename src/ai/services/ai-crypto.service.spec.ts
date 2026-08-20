import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AiCryptoService } from './ai-crypto.service';

describe('AiCryptoService', () => {
	function create(key?: string) {
		const config = {
			get: (name: string) => {
				if (name === 'AI_MODULE_ENCRYPTION_KEY') return key;
				if (name === 'JWT_SECRET') return 'test-jwt';
				return undefined;
			},
		} as ConfigService;
		return new AiCryptoService(config);
	}

	it('encrypts API keys at rest and decrypts them', () => {
		const crypto = create(randomBytes(32).toString('base64'));
		const secret = 'AIzaSyTestSecretKeyValue123';
		const encoded = crypto.encrypt(secret);
		expect(encoded).not.toContain(secret);
		expect(crypto.decrypt(encoded)).toBe(secret);
	});

	it('exposes only the last 4 characters', () => {
		const crypto = create();
		expect(crypto.last4('AIzaSyABCD1234WXYZ')).toBe('WXYZ');
		expect(crypto.mask('AIzaSyABCD1234WXYZ')).toBe('••••••••WXYZ');
	});

	it('rejects a dedicated key that is not 32 bytes', () => {
		const crypto = create(Buffer.from('short').toString('base64'));
		expect(() => crypto.encrypt('x')).toThrow('must decode to 32 bytes');
	});
});
