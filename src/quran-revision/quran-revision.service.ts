import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuranRevisionState } from 'entities/quran-revision.entity';

const HISTORY_MAX = 40;
const MISTAKES_MAX = 3000;
/** Production runs with synchronize off: add the notebook column at boot (additive). */
const MISTAKES_COLUMN = `ALTER TABLE quran_revision_states ADD COLUMN IF NOT EXISTS mistakes jsonb NOT NULL DEFAULT '[]'::jsonb`;
const EXTRA_COLUMNS = [
	`ALTER TABLE quran_revision_states ADD COLUMN IF NOT EXISTS bookmarks jsonb NOT NULL DEFAULT '[]'::jsonb`,
	`ALTER TABLE quran_revision_states ADD COLUMN IF NOT EXISTS "readingTime" jsonb NOT NULL DEFAULT '{}'::jsonb`,
];
const BOOKMARKS_MAX = 200;
const READING_DEVICES_MAX = 20;
const READING_DAYS_MAX = 400;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function asArray(v: unknown): any[] {
	return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

/** Newest edit of each mistake wins (deletes travel as `deletedAt` tombstones). */
function mergeMistakes(a: unknown, b: unknown): any[] {
	const byId = new Map<string, any>();
	[...asArray(a), ...asArray(b)].forEach((m) => {
		if (!m || typeof m !== 'object' || !m.id) return;
		const id = String(m.id);
		const prev = byId.get(id);
		if (!prev || Number(m.updatedAt || 0) >= Number(prev.updatedAt || 0)) byId.set(id, m);
	});
	return [...byId.values()].slice(-MISTAKES_MAX);
}

/** Bookmarks: newest edit of each id wins (same rule as mistakes). */
function mergeBookmarks(a: unknown, b: unknown): any[] {
	return mergeMistakes(a, b).slice(-BOOKMARKS_MAX);
}

/**
 * Reading time: each device only ever grows its own counters, so per device and day the
 * larger number is the newest. Devices are kept apart; the client adds them up.
 */
function mergeReadingTime(a: unknown, b: unknown): Record<string, Record<string, number>> {
	const out: Record<string, Record<string, number>> = {};
	[asObject(a), asObject(b)].forEach((src) => {
		Object.entries(src).forEach(([device, days]) => {
			if (!device || device.length > 64) return;
			const into = (out[device] = out[device] || {});
			Object.entries(asObject(days)).forEach(([day, sec]) => {
				const n = Number(sec);
				if (!DAY_KEY.test(day) || !Number.isFinite(n) || n < 0 || n > 86400) return;
				into[day] = Math.max(into[day] || 0, Math.round(n));
			});
		});
	});
	const latest = (d: string) => Object.keys(out[d]).sort().pop() || '';
	const devices = Object.keys(out)
		.filter((d) => Object.keys(out[d]).length)
		.sort((x, y) => latest(y).localeCompare(latest(x)))
		.slice(0, READING_DEVICES_MAX);
	return Object.fromEntries(
		devices.map((d) => {
			const keep = Object.keys(out[d]).sort().slice(-READING_DAYS_MAX);
			return [d, Object.fromEntries(keep.map((k) => [k, out[d][k]]))];
		}),
	);
}

function emptyState() {
	return {
		folders: [] as any[],
		favorites: [] as any[],
		history: [] as any[],
		wordErrors: {} as Record<string, string>,
		mistakes: [] as any[],
		bookmarks: [] as any[],
		readingTime: {} as Record<string, Record<string, number>>,
		activeSession: null as Record<string, any> | null,
	};
}

@Injectable()
export class QuranRevisionService implements OnModuleInit {
	private readonly logger = new Logger(QuranRevisionService.name);

	constructor(
		@InjectRepository(QuranRevisionState)
		private readonly repo: Repository<QuranRevisionState>,
	) {}

	async onModuleInit() {
		try {
			await this.repo.query(MISTAKES_COLUMN);
			for (const sql of EXTRA_COLUMNS) await this.repo.query(sql);
		} catch (error: any) {
			this.logger.warn(`mistakes column not ensured: ${error?.message || error}`);
		}
	}

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
			mistakes: asArray(row.mistakes),
			bookmarks: asArray(row.bookmarks),
			readingTime: asObject(row.readingTime),
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
		// Merge instead of replace: a phone and a laptop may both have logged mistakes offline.
		if ('mistakes' in patch) row.mistakes = mergeMistakes(row.mistakes, patch.mistakes);
		if ('bookmarks' in patch) row.bookmarks = mergeBookmarks(row.bookmarks, patch.bookmarks);
		if ('readingTime' in patch) row.readingTime = mergeReadingTime(row.readingTime, patch.readingTime);
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
			&& asArray(row.mistakes).length === 0
			&& !row.activeSession;

		if (cloudEmpty) {
			row.folders = asArray(incoming.folders);
			row.favorites = asArray(incoming.favorites);
			row.history = asArray(incoming.history).slice(0, HISTORY_MAX);
			row.wordErrors = asObject(incoming.wordErrors);
			row.mistakes = mergeMistakes([], incoming.mistakes);
			row.bookmarks = mergeBookmarks([], incoming.bookmarks);
			row.readingTime = mergeReadingTime({}, incoming.readingTime);
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
		row.mistakes = mergeMistakes(row.mistakes, incoming.mistakes);
		row.bookmarks = mergeBookmarks(row.bookmarks, incoming.bookmarks);
		row.readingTime = mergeReadingTime(row.readingTime, incoming.readingTime);
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
