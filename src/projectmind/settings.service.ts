import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiCryptoService } from '../ai/services/ai-crypto.service';
import { PmSetting } from './entities/projectmind.entities';

/** Workspace-level ProjectMind settings. The GitHub token is encrypted at rest and is never sent back to the browser. */
@Injectable()
export class SettingsService {
	constructor(
		@InjectRepository(PmSetting) private readonly repo: Repository<PmSetting>,
		private readonly crypto: AiCryptoService,
	) {}

	async githubStatus(workspaceId: string) {
		const row = await this.repo.findOne({ where: { workspaceId } });
		const configured = !!row?.githubTokenEnc;
		return { configured, last4: configured ? row!.githubTokenLast4 : null, updatedAt: configured ? row!.updatedAt : null };
	}

	async saveGithubToken(workspaceId: string, userId: string, token: string) {
		const t = String(token || '').trim();
		if (t.length < 20 || t.length > 255 || /\s/.test(t)) throw new BadRequestException('That does not look like a GitHub access token.');
		let row = await this.repo.findOne({ where: { workspaceId } });
		if (!row) row = this.repo.create({ workspaceId });
		row.githubTokenEnc = this.crypto.encrypt(t);
		row.githubTokenLast4 = this.crypto.last4(t);
		row.updatedBy = userId;
		await this.repo.save(row);
		return this.githubStatus(workspaceId);
	}

	async removeGithubToken(workspaceId: string) {
		await this.repo.update({ workspaceId }, { githubTokenEnc: null, githubTokenLast4: null });
		return this.githubStatus(workspaceId);
	}

	/** Decrypted token for server-side use only (GitHub import). Returns undefined when none saved or undecryptable. */
	async getGithubToken(workspaceId: string): Promise<string | undefined> {
		const row = await this.repo.findOne({ where: { workspaceId } });
		if (!row?.githubTokenEnc) return undefined;
		try {
			return this.crypto.decrypt(row.githubTokenEnc) || undefined;
		} catch {
			return undefined;
		}
	}
}
