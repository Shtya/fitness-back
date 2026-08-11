import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { WhatsAppProviderSession } from '../entities/whatsapp.entity';
import { resolveWppUserDataDir } from '../utils/whatsapp-browser-profile';

@Injectable()
export class WhatsAppSessionService {
	private readonly logger = new Logger(WhatsAppSessionService.name);
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

	/** Hard-delete the encrypted row — used when the account itself is removed. */
	async remove(accountId: string, providerName: string) {
		await this.repo.delete({ accountId, providerName });
		return true;
	}

	/** Multi-device WhatsApp keeps its linked-device keys in the Chromium profile,
	 *  not in wppconnect's setToken hook — so this table stays empty for it. Boot
	 *  restore must look at the profile on disk too, otherwise a restart always
	 *  falls back to a QR scan even though the session is still usable. */
	async hasActiveSession(accountId: string, providerName = 'wppconnect') {
		const row = await this.repo.findOne({
			where: { accountId, providerName, isActive: true },
			select: ['id'],
		});
		if (row) return true;
		if (providerName !== 'wppconnect') return false;
		try {
			const stats = await fsp.stat(
				path.join(resolveWppUserDataDir(accountId), 'Default', 'IndexedDB'),
			);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	createWppTokenStore(accountId: string) {
		return {
			getToken: (_sessionName: string) => this.load(accountId, 'wppconnect'),
			setToken: async (_sessionName: string, tokenData: any) => {
				if (!tokenData) return false;
				try {
					return await this.save(accountId, 'wppconnect', tokenData);
				} catch (error) {
					this.logger.warn(
						`Failed to save WPP token for ${accountId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
					return false;
				}
			},
			removeToken: (_sessionName: string) => this.clear(accountId, 'wppconnect'),
			listTokens: async () => {
				const token = await this.load(accountId, 'wppconnect');
				return token ? [accountId] : [];
			},
		};
	}
}
