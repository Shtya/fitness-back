import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { SmartSharedDocument } from 'entities/smart-document.entity';

function makeToken() {
	return randomBytes(12).toString('base64url');
}

@Injectable()
export class SmartDocumentService {
	constructor(
		@InjectRepository(SmartSharedDocument)
		private readonly repo: Repository<SmartSharedDocument>,
	) {}

	async upsertShare(
		userId: string,
		body: {
			localDocId?: string | null;
			title?: string;
			content?: string;
			typography?: Record<string, unknown> | null;
			token?: string | null;
		},
	) {
		const localDocId = body.localDocId ? String(body.localDocId).slice(0, 80) : null;
		const title = String(body.title || 'Untitled').trim().slice(0, 200) || 'Untitled';
		const content = String(body.content ?? '');
		const typography = body.typography && typeof body.typography === 'object' ? body.typography : null;

		let row: SmartSharedDocument | null = null;
		const requestedToken = String(body.token || '').trim();
		if (requestedToken) {
			row = await this.repo.findOne({ where: { token: requestedToken, ownerUserId: userId } });
		}
		if (!row && localDocId) {
			row = await this.repo.findOne({
				where: { localDocId, ownerUserId: userId },
				order: { updated_at: 'DESC' },
			});
		}

		if (!row) {
			row = this.repo.create({
				token: makeToken(),
				localDocId,
				ownerUserId: userId,
				title,
				content,
				typography,
			});
		} else {
			row.localDocId = localDocId || row.localDocId;
			row.title = title;
			row.content = content;
			row.typography = typography;
		}

		const saved = await this.repo.save(row);
		return {
			token: saved.token,
			title: saved.title,
			updatedAt: saved.updated_at,
			path: `/d/${saved.token}`,
		};
	}

	async getPublic(token: string) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');
		return {
			token: row.token,
			title: row.title,
			content: row.content,
			typography: row.typography,
			updatedAt: row.updated_at,
		};
	}

	async updatePublic(
		token: string,
		body: { content?: string; title?: string; typography?: Record<string, unknown> | null },
	) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');
		if (body.content != null) row.content = String(body.content);
		if (body.title != null) {
			const next = String(body.title).trim().slice(0, 200);
			if (next) row.title = next;
		}
		if (body.typography !== undefined) {
			row.typography =
				body.typography && typeof body.typography === 'object' ? body.typography : null;
		}
		const saved = await this.repo.save(row);
		return {
			token: saved.token,
			title: saved.title,
			content: saved.content,
			typography: saved.typography,
			updatedAt: saved.updated_at,
		};
	}
}
