import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuranRevisionState } from 'entities/quran-revision.entity';

const HISTORY_MAX = 40;

function asArray(v: unknown): any[] {
	return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function emptyState() {
	return {
		folders: [] as any[],
		favorites: [] as any[],
		history: [] as any[],
		wordErrors: {} as Record<string, string>,
		activeSession: null as Record<string, any> | null,
	};
}

@Injectable()
export class QuranRevisionService {
	constructor(
		@InjectRepository(QuranRevisionState)
		private readonly repo: Repository<QuranRevisionState>,
	) {}

	private userId(user: any): string {
		const id = user?.id;
		if (!id) throw new UnauthorizedException('Missing user id');
		return String(id);
	}

	private toDto(row: QuranRevisionState | null) {
		if (!row) return emptyState();
		return {
			folders: asArray(row.folders),
			favorites: asArray(row.favorites),
			history: asArray(row.history).slice(0, HISTORY_MAX),
			wordErrors: asObject(row.wordErrors),
			activeSession:
				row.activeSession && typeof row.activeSession === 'object'
					? row.activeSession
					: null,
			updatedAt: row.updated_at ?? null,
		};
	}

	private async getOrCreate(userId: string): Promise<QuranRevisionState> {
		let row = await this.repo.findOne({ where: { userId } });
		if (row) return row;
		row = this.repo.create({
			userId,
			...emptyState(),
		});
		return this.repo.save(row);
	}

	async getState(user: any) {
		const userId = this.userId(user);
		const row = await this.repo.findOne({ where: { userId } });
		return this.toDto(row);
	}

	async putState(user: any, body: any) {
		const userId = this.userId(user);
		const row = await this.getOrCreate(userId);
		const patch = body && typeof body === 'object' ? body : {};

		if ('folders' in patch) row.folders = asArray(patch.folders);
		if ('favorites' in patch) row.favorites = asArray(patch.favorites);
		if ('history' in patch) row.history = asArray(patch.history).slice(0, HISTORY_MAX);
		if ('wordErrors' in patch) row.wordErrors = asObject(patch.wordErrors);
		if ('activeSession' in patch) {
			row.activeSession =
				patch.activeSession && typeof patch.activeSession === 'object'
					? patch.activeSession
					: null;
		}

		const saved = await this.repo.save(row);
		return this.toDto(saved);
	}

	/** One-shot migrate from device localStorage when cloud is empty / sparse. */
	async importState(user: any, body: any) {
		const userId = this.userId(user);
		const row = await this.getOrCreate(userId);
		const incoming = body && typeof body === 'object' ? body : {};
		const cloudEmpty =
			asArray(row.folders).length === 0
			&& asArray(row.favorites).length === 0
			&& asArray(row.history).length === 0
			&& Object.keys(asObject(row.wordErrors)).length === 0
			&& !row.activeSession;

		if (cloudEmpty) {
			row.folders = asArray(incoming.folders);
			row.favorites = asArray(incoming.favorites);
			row.history = asArray(incoming.history).slice(0, HISTORY_MAX);
			row.wordErrors = asObject(incoming.wordErrors);
			row.activeSession =
				incoming.activeSession && typeof incoming.activeSession === 'object'
					? incoming.activeSession
					: null;
			const saved = await this.repo.save(row);
			return { ...this.toDto(saved), imported: true };
		}

		// Merge: prefer cloud, fill gaps from device
		const folderById = new Map<string, any>();
		asArray(row.folders).forEach((f) => {
			if (f?.id) folderById.set(String(f.id), f);
		});
		asArray(incoming.folders).forEach((f) => {
			if (f?.id && !folderById.has(String(f.id))) folderById.set(String(f.id), f);
		});

		const favByKey = new Map<string, any>();
		const favKey = (f: any) => String(f?.id || f?.videoId || '');
		asArray(row.favorites).forEach((f) => {
			const k = favKey(f);
			if (k) favByKey.set(k, f);
		});
		asArray(incoming.favorites).forEach((f) => {
			const k = favKey(f);
			if (k && !favByKey.has(k)) favByKey.set(k, f);
		});

		const histById = new Map<string, any>();
		asArray(row.history).forEach((h) => {
			if (h?.id) histById.set(String(h.id), h);
		});
		asArray(incoming.history).forEach((h) => {
			if (h?.id && !histById.has(String(h.id))) histById.set(String(h.id), h);
		});

		row.folders = [...folderById.values()];
		row.favorites = [...favByKey.values()];
		row.history = [...histById.values()]
			.sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0))
			.slice(0, HISTORY_MAX);
		row.wordErrors = {
			...asObject(incoming.wordErrors),
			...asObject(row.wordErrors),
		};
		const cloudSession = row.activeSession;
		const deviceSession = incoming.activeSession;
		const cloudAt = Number(cloudSession?.updatedAt || 0);
		const deviceAt = Number(deviceSession?.updatedAt || 0);
		if (!cloudSession && deviceSession) row.activeSession = deviceSession;
		else if (cloudSession && deviceSession && deviceAt > cloudAt) {
			row.activeSession = deviceSession;
		}

		const saved = await this.repo.save(row);
		return { ...this.toDto(saved), imported: false, merged: true };
	}
}
