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
		return {
			books: asArray(row.books),
			prompts: asArray(row.prompts),
			topics: asArray(row.topics),
			journeys: asArray(row.journeys),
			prefs: asObject(row.prefs),
			stats: asObject(row.stats),
			chat: row.chat && typeof row.chat === 'object' ? row.chat : null,
			updatedAt: row.updated_at ?? null,
		};
	}

	private async getOrCreate(userId: string): Promise<AiReadingState> {
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
		if ('stats' in patch) row.stats = asObject(patch.stats);
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

	async deleteBook(user: any, id: string) {
		const userId = this.userId(user);
		const row = await this.getOrCreate(userId);
		row.books = asArray(row.books).filter(b => b?.id !== id);
		await this.repo.save(row);
		return { ok: true };
	}
}
