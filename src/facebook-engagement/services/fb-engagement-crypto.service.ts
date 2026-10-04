import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FbEngagementCryptoService {
	constructor(private readonly config: ConfigService) {}

	private encryptionKey() {
		const dedicated = this.config.get<string>('FB_ENGAGEMENT_ENCRYPTION_KEY')?.trim();
		if (dedicated) {
			const key = Buffer.from(dedicated, 'base64');
			if (key.length !== 32) {
				throw new Error('FB_ENGAGEMENT_ENCRYPTION_KEY must decode to 32 bytes');
			}
			return key;
		}
		const jwtSecret = this.config.get<string>('JWT_SECRET')?.trim();
		if (!jwtSecret) {
			throw new Error('FB_ENGAGEMENT_ENCRYPTION_KEY or JWT_SECRET must be configured');
		}
		return createHash('sha256').update(`so7bafit:facebook-engagement-tokens:${jwtSecret}`).digest();
	}

	encrypt(plain: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	decrypt(encoded: string): string {
		const payload = Buffer.from(encoded, 'base64');
		const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), payload.subarray(0, 12));
		decipher.setAuthTag(payload.subarray(12, 28));
		return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
	}
}
