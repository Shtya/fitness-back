import {
	BadRequestException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiReadingState } from 'entities/ai-reading.entity';

const BOOKS_MAX = 80;
const PROMPTS_MAX = 120;
const TOPICS_MAX = 200;
const JOURNEYS_MAX = 40;
const NOTES_MAX = 500;
const NOTE_TEXT_MAX = 4000;
/** Notebook lives inside `stats` jsonb so no schema migration is required. */
const NOTEBOOK_KEY = '_notebook';

function sanitizeNotes(v: unknown) {
	return asArray(v)
		.filter(n => n && typeof n === 'object' && n.id && typeof n.text === 'string')
		.slice(0, NOTES_MAX)
		.map(n => ({
			id: String(n.id).slice(0, 64),
			text: n.text.slice(0, NOTE_TEXT_MAX),
			done: Boolean(n.done),
			bookId: n.bookId ? String(n.bookId).slice(0, 64) : null,
			bookTitle: n.bookTitle ? String(n.bookTitle).slice(0, 200) : null,
			createdAt: n.createdAt ? String(n.createdAt) : new Date().toISOString(),
			updatedAt: n.updatedAt ? String(n.updatedAt) : new Date().toISOString(),
		}));
}

function asArray(v: unknown): any[] {
	return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, any>)
		: {};
}

function emptyState() {
	return {
		books: [] as any[],
		prompts: [] as any[],
		topics: [] as any[],
		journeys: [] as any[],
		prefs: {} as Record<string, any>,
		stats: {} as Record<string, any>,
		chat: null as Record<string, any> | null,
		notebook: { notes: [] as any[] },
	};
}

@Injectable()
export class AiReadingService {
	constructor(
		@InjectRepository(AiReadingState)
		private readonly repo: Repository<AiReadingState>,
	) {}

	private userId(user: any): string {
		const id = user?.id;
		if (!id) throw new UnauthorizedException('Missing user id');
		return String(id);
	}

	private toDto(row: AiReadingState | null) {
		if (!row) return emptyState();
		const { [NOTEBOOK_KEY]: notebook, ...stats } = asObject(row.stats);
		return {
			books: asArray(row.books),
			prompts: asArray(row.prompts),
			topics: asArray(row.topics),
			journeys: asArray(row.journeys),
			prefs: asObject(row.prefs),
			stats,
			chat: row.chat && typeof row.chat === 'object' ? row.chat : null,
			notebook: { notes: sanitizeNotes(asObject(notebook).notes) },
			updatedAt: row.updated_at ?? null,
		};
	}

	private async getOrCreate(userId: string): Promise<AiReadingState> {
		let row = await this.repo.findOne({ where: { userId } });
		if (row) return row;
		const { notebook: _notebook, ...initial } = emptyState();
		row = this.repo.create({ userId, ...initial });
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

		if ('books' in patch) {
			row.books = asArray(patch.books)
				.filter(b => b && typeof b === 'object' && b.id)
				.slice(0, BOOKS_MAX);
		}
		if ('prompts' in patch) {
			row.prompts = asArray(patch.prompts)
				.filter(p => p && typeof p === 'object' && p.id)
				.slice(0, PROMPTS_MAX);
		}
		if ('topics' in patch) {
			row.topics = asArray(patch.topics)
				.filter(t => t && typeof t === 'object' && t.id)
				.slice(0, TOPICS_MAX);
		}
		if ('journeys' in patch) {
			row.journeys = asArray(patch.journeys)
				.filter(j => j && typeof j === 'object' && j.id)
				.slice(0, JOURNEYS_MAX);
		}
		if ('prefs' in patch) row.prefs = asObject(patch.prefs);
		if ('stats' in patch) {
			const { [NOTEBOOK_KEY]: _ignored, ...stats } = asObject(patch.stats);
			const notebook = asObject(row.stats)[NOTEBOOK_KEY];
			row.stats = notebook ? { ...stats, [NOTEBOOK_KEY]: notebook } : stats;
		}
		if ('chat' in patch) {
			row.chat =
				patch.chat && typeof patch.chat === 'object' ? patch.chat : null;
		}

		const saved = await this.repo.save(row);
		return this.toDto(saved);
	}

	/** Upsert a single book without rewriting unrelated collections. */
	async upsertBook(user: any, book: any) {
		const userId = this.userId(user);
		if (!book?.id) throw new BadRequestException('book.id required');
		const row = await this.getOrCreate(userId);
		const books = asArray(row.books);
		const next = { ...book, updatedAt: new Date().toISOString() };
		const idx = books.findIndex(b => b?.id === next.id);
		if (idx >= 0) books[idx] = next;
		else books.unshift(next);
		row.books = books.slice(0, BOOKS_MAX);
		await this.repo.save(row);
		return next;
	}

	/** Atomic notebook write — does not touch books/prefs/stats written by other requests. */
	async putNotebook(user: any, body: any) {
		const userId = this.userId(user);
		await this.getOrCreate(userId);
		const notes = sanitizeNotes(asObject(body).notes);
		const notebook = { notes, updatedAt: new Date().toISOString() };
		await this.repo.query(
			`UPDATE ai_reading_states
			 SET stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{${NOTEBOOK_KEY}}', $1::jsonb, true),
			     updated_at = now()
			 WHERE "userId" = $2 AND deleted_at IS NULL`,
			[JSON.stringify(notebook), userId],
		);
		return notebook;
	}

	async deleteBook(user: any, id: string) {
		const userId = this.userId(user);
		const row = await this.getOrCreate(userId);
		row.books = asArray(row.books).filter(b => b?.id !== id);
		await this.repo.save(row);
		return { ok: true };
	}
}
