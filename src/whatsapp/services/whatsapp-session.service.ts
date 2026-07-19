import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WhatsAppProviderSession } from '../entities/whatsapp.entity';

@Injectable()
export class WhatsAppSessionService {
	private readonly algorithm = 'aes-256-gcm';

	constructor(
		@InjectRepository(WhatsAppProviderSession)
		private readonly repo: Repository<WhatsAppProviderSession>,
	) {}

	private getKey() {
		const raw = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
		if (!raw) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY is not configured');
		const key = Buffer.from(raw, 'base64');
		if (key.length !== 32) {
			throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY must decode to 32 bytes');
		}
		return key;
	}

	private encrypt(value: unknown) {
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv(this.algorithm, this.getKey(), iv);
		const encrypted = Buffer.concat([
			cipher.update(JSON.stringify(value), 'utf8'),
			cipher.final(),
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
	}

	private decrypt<T>(encoded: string): T {
		const payload = Buffer.from(encoded, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = crypto.createDecipheriv(this.algorithm, this.getKey(), iv);
		decipher.setAuthTag(tag);
		return JSON.parse(
			Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
		) as T;
	}

	async load<T>(accountId: string, providerName: string): Promise<T | undefined> {
		const row = await this.repo.findOne({
			where: { accountId, providerName, isActive: true },
		});
		return row ? this.decrypt<T>(row.encryptedData) : undefined;
	}

	async save(accountId: string, providerName: string, data: unknown) {
		let row = await this.repo.findOne({ where: { accountId, providerName } });
		if (!row) row = this.repo.create({ accountId, providerName });
		row.encryptedData = this.encrypt(data);
		row.isActive = true;
		row.keyVersion = 1;
		await this.repo.save(row);
		return true;
	}

	async clear(accountId: string, providerName: string) {
		await this.repo.update({ accountId, providerName }, { isActive: false });
		return true;
	}

	createWppTokenStore(accountId: string) {
		return {
			getToken: (_sessionName: string) => this.load(accountId, 'wppconnect'),
			setToken: (_sessionName: string, tokenData: any) =>
				tokenData ? this.save(accountId, 'wppconnect', tokenData) : Promise.resolve(false),
			removeToken: (_sessionName: string) => this.clear(accountId, 'wppconnect'),
			listTokens: async () => {
				const token = await this.load(accountId, 'wppconnect');
				return token ? [accountId] : [];
			},
		};
	}
}
