import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiProviderCredentialEntity } from '../entities/ai.entity';
import { AiCryptoService } from './ai-crypto.service';
import { aiNotConfigured } from '../ai.errors';

@Injectable()
export class AiCredentialsService {
	constructor(
		@InjectRepository(AiProviderCredentialEntity)
		private readonly repo: Repository<AiProviderCredentialEntity>,
		private readonly crypto: AiCryptoService,
	) {}

	async publicStatus(workspaceId: string, provider: string) {
		const row = await this.repo.findOne({ where: { workspaceId, provider } });
		if (!row) {
			return { provider, configured: false, last4: null, verifiedAt: null, updatedAt: null };
		}
		return {
			provider,
			configured: true,
			last4: row.keyLast4,
			masked: row.keyLast4 ? `••••••••${row.keyLast4}` : '••••',
			verifiedAt: row.verifiedAt,
			updatedAt: row.updatedAt,
		};
	}

	async save(workspaceId: string, provider: string, apiKey: string, userId?: string) {
		const normalized = String(apiKey || '').trim();
		if (!normalized) throw aiNotConfigured(provider);
		let row = await this.repo.findOne({ where: { workspaceId, provider } });
		if (!row) row = this.repo.create({ workspaceId, provider });
		row.encryptedApiKey = this.crypto.encrypt(normalized);
		row.keyLast4 = this.crypto.last4(normalized);
		row.updatedBy = userId || null;
		row.verifiedAt = null;
		await this.repo.save(row);
		return this.publicStatus(workspaceId, provider);
	}

	async markVerified(workspaceId: string, provider: string) {
		await this.repo.update({ workspaceId, provider }, { verifiedAt: new Date() });
		return this.publicStatus(workspaceId, provider);
	}

	async remove(workspaceId: string, provider: string) {
		await this.repo.delete({ workspaceId, provider });
		return { provider, configured: false, last4: null };
	}

	async getApiKey(workspaceId: string, provider: string): Promise<string> {
		const row = await this.repo.findOne({ where: { workspaceId, provider } });
		if (!row?.encryptedApiKey) throw aiNotConfigured(provider);
		try {
			const key = this.crypto.decrypt(row.encryptedApiKey)?.trim();
			if (!key) throw aiNotConfigured(provider);
			return key;
		} catch (err) {
			if ((err as any)?.aiCode === 'AI_NOT_CONFIGURED') throw err;
			throw aiNotConfigured(provider);
		}
	}
}
