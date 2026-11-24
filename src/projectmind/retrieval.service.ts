import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RetrievedChunk } from './chat/query';
import { PmFile } from './entities/projectmind.entities';
import { PM_LIMITS } from './projectmind.constants';
import { idf, scoreChunk } from './retrieval-scoring';

const PER_TERM_CANDIDATES = 60;
const PATH_CANDIDATES = 40;
const FINAL_POOL = 40;
const MAX_PER_FILE = 4;

/**
 * Hybrid lexical retrieval over pm_chunks: Postgres full-text (GIN) for candidate generation, then idf-weighted
 * scoring that rewards rare terms, file-name matches and symbol matches, with priors against tests/translations/css.
 * No embeddings: the existing AI module exposes text generation only, and pgvector availability on the shared
 * database is unverified (see docs/projectmind/DECISIONS.md).
 */
@Injectable()
export class RetrievalService {
	constructor(
		@InjectDataSource() private readonly ds: DataSource,
		@InjectRepository(PmFile) private readonly files: Repository<PmFile>,
	) {}

	async retrieve(projectId: string, rawTerms: string[], topK: number = PM_LIMITS.retrievalTopK): Promise<RetrievedChunk[]> {
		const terms = [...new Set(rawTerms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter((t) => t.length >= 2))].slice(0, 24);
		if (!terms.length) return [];
		const tsq = terms.map((t) => `${t}:*`);

		const [{ n: total }] = (await this.ds.query('SELECT count(*)::int AS n FROM pm_chunks WHERE project_id = $1', [projectId])) as Array<{ n: number }>;
		if (!total) return [];
		const dfs = await Promise.all(tsq.map((q) => this.ds.query(`SELECT count(*)::int AS n FROM pm_chunks WHERE project_id = $1 AND tsv @@ to_tsquery('simple', $2)`, [projectId, q]).then((r: Array<{ n: number }>) => r[0].n)));
		const pathDfs = await Promise.all(terms.map((t) => this.ds.query('SELECT count(*)::int AS n FROM pm_chunks WHERE project_id = $1 AND path ILIKE $2', [projectId, `%${t}%`]).then((r: Array<{ n: number }>) => r[0].n)));
		// A term counts as "present" when it occurs in text or in some path.
		const weights = dfs.map((df, i) => (df + pathDfs[i] === 0 ? 0 : idf(total, Math.max(df, 1))));
		const pathWeights = pathDfs.map((df, i) => (weights[i] === 0 ? 0 : idf(total, Math.max(df, 1))));

		// 1) candidates: top chunks per term (so rare terms are never crowded out by common ones) + path matches
		const candidateIds = new Set<string>();
		await Promise.all([
			...tsq.map(async (q, i) => {
				if (!dfs[i]) return;
				const rows: Array<{ id: string }> = await this.ds.query(
					`SELECT id FROM pm_chunks WHERE project_id = $1 AND tsv @@ to_tsquery('simple', $2) ORDER BY ts_rank_cd(tsv, to_tsquery('simple', $2)) DESC LIMIT ${PER_TERM_CANDIDATES}`,
					[projectId, q],
				);
				rows.forEach((r) => candidateIds.add(r.id));
			}),
			...terms.map(async (t) => {
				if (t.length < 3) return;
				const rows: Array<{ id: string }> = await this.ds.query(`SELECT id FROM pm_chunks WHERE project_id = $1 AND path ILIKE $2 LIMIT ${PATH_CANDIDATES}`, [projectId, `%${t}%`]);
				rows.forEach((r) => candidateIds.add(r.id));
			}),
		]);
		if (!candidateIds.size) return [];

		// 2) which of the question's terms does each candidate really match?
		const meta: Array<{ id: string; path: string; symbols: string; matched: number[] | null }> = await this.ds.query(
			`SELECT c.id, c.path, c.symbols,
			        (SELECT array_agg(i - 1) FROM generate_series(1, cardinality($2::text[])) i WHERE c.tsv @@ to_tsquery('simple', ($2::text[])[i])) AS matched
			   FROM pm_chunks c WHERE c.project_id = $1 AND c.id = ANY($3::uuid[])`,
			[projectId, tsq, [...candidateIds]],
		);

		// 3) score, keep a pool, load text only for the pool
		const scored = meta.map((m) => ({ id: m.id, path: m.path, score: scoreChunk({ path: m.path, symbols: m.symbols || '', matched: m.matched || [], terms, weights, pathWeights }) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, FINAL_POOL);
		if (!scored.length) return [];
		const rows: Array<{ id: string; path: string; start_line: number; end_line: number; text: string; symbols: string }> = await this.ds.query(
			'SELECT id, path, start_line, end_line, text, symbols FROM pm_chunks WHERE id = ANY($1::uuid[])',
			[scored.map((s) => s.id)],
		);
		const byId = new Map(rows.map((r) => [r.id, r]));

		// 4) per-file cap so one large file cannot crowd out the rest
		const perFile = new Map<string, number>();
		const out: RetrievedChunk[] = [];
		for (const s of scored) {
			const r = byId.get(s.id);
			if (!r) continue;
			const n = perFile.get(r.path) || 0;
			if (n >= MAX_PER_FILE) continue;
			perFile.set(r.path, n + 1);
			out.push({ id: r.id, path: r.path, startLine: r.start_line, endLine: r.end_line, text: r.text, symbols: r.symbols, score: Math.round(s.score * 1000) / 1000 });
			if (out.length >= topK) break;
		}
		return out;
	}

	/**
	 * Which of these named things occur NOWHERE in the project (neither in any chunk's full text nor in any path)?
	 * Terms are matched as prefixes, so "kafka" would match kafkajs too.
	 */
	async absentEntities(projectId: string, entities: string[]): Promise<string[]> {
		const out: string[] = [];
		for (const e of entities.slice(0, 6)) {
			const t = e.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
			if (t.length < 3) continue;
			const [row]: Array<{ present: boolean }> = await this.ds.query(
				`SELECT (EXISTS (SELECT 1 FROM pm_chunks WHERE project_id = $1 AND tsv @@ to_tsquery('simple', $2))
				      OR EXISTS (SELECT 1 FROM pm_chunks WHERE project_id = $1 AND path ILIKE $3)) AS present`,
				[projectId, `${t}:*`, `%${t}%`],
			);
			if (!row?.present) out.push(e);
		}
		return out;
	}

	async knownPaths(projectId: string): Promise<Set<string>> {
		const rows = await this.files.find({ where: { projectId, excluded: false }, select: ['path'] });
		return new Set(rows.map((r) => r.path));
	}
}
