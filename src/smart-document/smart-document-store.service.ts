import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { SmartDocument, SmartSharedDocument } from 'entities/smart-document.entity';
import {
	MAX_DOCS_PER_USER,
	decideUpsert,
	latestSharePerDoc,
	normalizeIncomingDoc,
	type IncomingDoc,
} from './smart-document-store.rules';

export type DocDto = { id: string; title: string; titleLocked: boolean; content: string; updatedAt: number };

function toDto(row: SmartDocument): DocDto {
	return {
		id: row.clientId,
		title: row.title,
		titleLocked: row.titleLocked,
		content: row.content,
		updatedAt: new Date(row.clientUpdatedAt).getTime(),
	};
}

/** The signed-in user's own documents (Documents editor). Every query is scoped to the owner. */
@Injectable()
export class SmartDocumentStoreService {
	constructor(
		@InjectRepository(SmartDocument) private readonly docs: Repository<SmartDocument>,
		@InjectRepository(SmartSharedDocument) private readonly shares: Repository<SmartSharedDocument>,
	) {}

	async list(ownerUserId: string): Promise<DocDto[]> {
		const rows = await this.docs.find({
			where: { ownerUserId },
			order: { clientUpdatedAt: 'DESC' },
			take: MAX_DOCS_PER_USER,
		});
		return rows.map(toDto);
	}

	/** Save one document; the newer copy wins. Returns the copy now stored (null when deleted). */
	async upsert(ownerUserId: string, raw: unknown): Promise<DocDto | null> {
		const doc = normalizeIncomingDoc(raw);
		if (!doc) throw new BadRequestException('Invalid document');
		const row = await this.save(ownerUserId, doc);
		return row && !row.deleted_at ? toDto(row) : null;
	}

	async remove(ownerUserId: string, clientId: string): Promise<{ ok: true }> {
		const row = await this.docs.findOne({ where: { ownerUserId, clientId: String(clientId || '').slice(0, 80) } });
		if (row) await this.docs.softRemove(row);
		return { ok: true };
	}

	/**
	 * The editor's whole local list on open: keep the newer copy of each, bring back documents
	 * that were only ever shared (their content lives in the share rows), and return the list.
	 */
	async sync(ownerUserId: string, rawDocs: unknown): Promise<DocDto[]> {
		const list = Array.isArray(rawDocs) ? rawDocs.slice(0, MAX_DOCS_PER_USER) : [];
		for (const raw of list) {
			const doc = normalizeIncomingDoc(raw);
			if (doc) await this.save(ownerUserId, doc);
		}
		await this.recoverShared(ownerUserId);
		return this.list(ownerUserId);
	}

	private async save(ownerUserId: string, doc: IncomingDoc): Promise<SmartDocument | null> {
		const stored = await this.docs.findOne({ where: { ownerUserId, clientId: doc.clientId }, withDeleted: true });
		const action = decideUpsert(
			stored ? { clientUpdatedAt: stored.clientUpdatedAt, deletedAt: stored.deleted_at } : null,
			doc,
		);
		if (action === 'keep') return stored;
		const row =
			stored ||
			this.docs.create({ ownerUserId, clientId: doc.clientId });
		row.title = doc.title;
		row.titleLocked = doc.titleLocked;
		row.content = doc.content;
		row.clientUpdatedAt = doc.updatedAt;
		if (action === 'restore') row.deleted_at = null;
		return this.docs.save(row);
	}

	/** Shared documents of this owner that have no server copy yet (deleted ones stay deleted). */
	private async recoverShared(ownerUserId: string) {
		const shared = await this.shares.find({
			where: { ownerUserId, localDocId: Not(IsNull()) },
			select: { id: true, localDocId: true, title: true, content: true, updated_at: true },
			take: 500,
		});
		for (const share of latestSharePerDoc(shared)) {
			if (!String(share.content || '').trim()) continue;
			const exists = await this.docs.exists({ where: { ownerUserId, clientId: String(share.localDocId) }, withDeleted: true });
			if (exists) continue;
			await this.docs.save(
				this.docs.create({
					ownerUserId,
					clientId: String(share.localDocId),
					title: String(share.title || 'Untitled').slice(0, 200),
					titleLocked: false,
					content: share.content,
					clientUpdatedAt: new Date(share.updated_at),
				}),
			);
		}
	}
}
