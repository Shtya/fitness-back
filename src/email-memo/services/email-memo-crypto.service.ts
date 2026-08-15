import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailMemoCryptoService {
	constructor(private readonly config: ConfigService) {}

	private encryptionKey() {
		const dedicated = this.config.get<string>('EMAIL_MEMO_ENCRYPTION_KEY')?.trim();
		if (dedicated) {
			const key = Buffer.from(dedicated, 'base64');
			if (key.length !== 32) {
				throw new Error('EMAIL_MEMO_ENCRYPTION_KEY must decode to 32 bytes');
			}
			return key;
		}
		const whatsapp = this.config.get<string>('WHATSAPP_SESSION_ENCRYPTION_KEY')?.trim();
		if (whatsapp) {
			const key = Buffer.from(whatsapp, 'base64');
			if (key.length === 32) return key;
		}
		const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		return createHash('sha256').update(`so7bafit:email-memo:${jwtSecret}`).digest();
	}

	encrypt(payload: unknown): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(payload), 'utf8'),
			cipher.final(),
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	decrypt<T>(encoded: string): T {
		const payload = Buffer.from(encoded, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return JSON.parse(
			Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
		) as T;
	}
}
