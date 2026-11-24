import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { buildTsQuery, RetrievedChunk } from './chat/query';
import { PmFile } from './entities/projectmind.entities';
import { PM_LIMITS } from './projectmind.constants';

/**
 * Lexical retrieval over pm_chunks (Postgres full-text, 'simple' config, prefix matching) with a path boost.
 * No embeddings: the existing AI module exposes text generation only, and pgvector availability on the shared
 * database is unverified. See docs/projectmind/DECISIONS.md.
 */
@Injectable()
export class RetrievalService {
	constructor(
		@InjectDataSource() private readonly ds: DataSource,
		@InjectRepository(PmFile) private readonly files: Repository<PmFile>,
	) {}

	/** Top-k chunks with a per-file cap (3) so one large file cannot crowd out the rest. */
	async retrieve(projectId: string, terms: string[], topK: number = PM_LIMITS.retrievalTopK): Promise<RetrievedChunk[]> {
		const tsq = buildTsQuery(terms);
		if (!tsq) return [];
		const patterns = terms.map((t) => `%${t.replace(/[%_\\]/g, '')}%`);
		const rows: Array<{ id: string; path: string; start_line: number; end_line: number; text: string; symbols: string; score: number }> = await this.ds.query(
			`SELECT c.id, c.path, c.start_line, c.end_line, c.text, c.symbols,
			        ts_rank_cd(c.tsv, q.q) + 0.2 * (SELECT count(*) FROM unnest($3::text[]) p WHERE c.path ILIKE p) AS score
			   FROM pm_chunks c, to_tsquery('simple', $2) q(q)
			  WHERE c.project_id = $1 AND c.tsv @@ q.q
			  ORDER BY score DESC
			  LIMIT 60`,
			[projectId, tsq, patterns],
		);
		const perFile = new Map<string, number>();
		const out: RetrievedChunk[] = [];
		for (const r of rows) {
			const n = perFile.get(r.path) || 0;
			if (n >= 3) continue;
			perFile.set(r.path, n + 1);
			out.push({ id: r.id, path: r.path, startLine: r.start_line, endLine: r.end_line, text: r.text, symbols: r.symbols, score: Number(r.score) });
			if (out.length >= topK) break;
		}
		return out;
	}

	async knownPaths(projectId: string): Promise<Set<string>> {
		const rows = await this.files.find({ where: { projectId, excluded: false }, select: ['path'] });
		return new Set(rows.map((r) => r.path));
	}
}
