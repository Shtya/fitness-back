import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiCryptoService {
	constructor(private readonly config: ConfigService) {}

	encryptionKey() {
		const dedicated = this.config.get<string>('AI_MODULE_ENCRYPTION_KEY')?.trim();
		if (dedicated) {
			const key = Buffer.from(dedicated, 'base64');
			if (key.length !== 32) {
				throw new Error('AI_MODULE_ENCRYPTION_KEY must decode to 32 bytes');
			}
			return key;
		}
		const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		return createHash('sha256').update(`so7bafit:ai-module-secrets:${jwtSecret}`).digest();
	}

	encrypt(value: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	decrypt(encoded: string): string {
		const payload = Buffer.from(encoded, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	}

	last4(value: string | null | undefined): string | null {
		if (!value) return null;
		const trimmed = value.trim();
		if (trimmed.length <= 4) return trimmed;
		return trimmed.slice(-4);
	}

	mask(value: string | null | undefined): string | null {
		const last = this.last4(value);
		return last ? `••••••••${last}` : null;
	}
}
