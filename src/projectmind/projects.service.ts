import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AnalyzedFile, analyzeFiles, ProjectAnalysis } from './analysis/analyzer';
import { resolveImport } from './analysis/imports';
import { ArchiveError, extractZip } from './import/zip-extract';
import { downloadGithubZip, GithubImportError, parseGithubUrl } from './import/github-import';
import { PmAuditLog, PmFile, PmProject } from './entities/projectmind.entities';
import { PM_LIMITS } from './projectmind.constants';
import { DocsService } from './docs.service';
import { GapsService } from './gaps.service';
import { RetrievalService } from './retrieval.service';

export type PmUser = { id: string; tenantId?: string | null; adminId?: string | null; tokenTenantId?: string | null; role?: string };

/** Same workspace rule as AiService.workspaceId — one source of tenant isolation. */
export function workspaceOf(user: PmUser): string {
	const id = user?.tenantId || user?.tokenTenantId || user?.adminId || user?.id;
	if (!id) throw new BadRequestException('Authenticated user is missing a workspace id.');
	return id;
}

export interface CreateProjectInput {
	name: string;
	description?: string;
	sourceType: 'zip' | 'github';
	sourceUrl?: string;
	branch?: string;
	githubToken?: string;
}

@Injectable()
export class ProjectsService implements OnModuleInit {
	private readonly logger = new Logger('ProjectMind');
	private running = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(
		@InjectRepository(PmProject) private readonly projects: Repository<PmProject>,
		@InjectRepository(PmFile) private readonly files: Repository<PmFile>,
		@InjectRepository(PmAuditLog) private readonly audit: Repository<PmAuditLog>,
		@InjectDataSource() private readonly ds: DataSource,
		private readonly docs: DocsService,
		private readonly gaps: GapsService,
		private readonly retrieval: RetrievalService,
	) {}

	/** Jobs run in-process; anything left mid-flight by a restart is marked failed so the UI never shows a stuck spinner. */
	async onModuleInit() {
		try {
			await this.projects
				.createQueryBuilder()
				.update()
				.set({ status: 'failed', statusMessage: 'Interrupted by a server restart. Re-import to try again.' })
				.where("status IN ('importing','analyzing')")
				.execute();
		} catch (e: any) {
			this.logger.warn(`ProjectMind tables are not available yet (apply migrations/20261124_projectmind_init.sql): ${e?.message}`);
		}
	}

	async log(user: PmUser, action: string, projectId: string | null, meta: Record<string, unknown> = {}) {
		try {
			await this.audit.save(this.audit.create({ workspaceId: workspaceOf(user), userId: user.id, projectId, action, meta }));
		} catch (e: any) {
			this.logger.warn(`audit log failed: ${e?.message}`);
		}
	}

	/** Loads a project owned by the caller's workspace or throws 404 (never reveals other tenants' ids). */
	async require(user: PmUser, id: string): Promise<PmProject> {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new NotFoundException('Project not found');
		const p = await this.projects.findOne({ where: { id, workspaceId: workspaceOf(user) } });
		if (!p) throw new NotFoundException('Project not found');
		return p;
	}

	list(user: PmUser) {
		return this.projects.find({ where: { workspaceId: workspaceOf(user) }, order: { updatedAt: 'DESC' }, select: { analysis: false } as any });
	}

	async create(user: PmUser, input: CreateProjectInput) {
		const name = String(input.name || '').trim();
		if (name.length < 2 || name.length > 160) throw new BadRequestException('Project name must be 2-160 characters.');
		if (input.sourceType !== 'zip' && input.sourceType !== 'github') throw new BadRequestException('sourceType must be "zip" or "github".');
		let sourceUrl: string | null = null;
		let branch: string | null = null;
		if (input.sourceType === 'github') {
			try {
				const ref = parseGithubUrl(input.sourceUrl || '');
				sourceUrl = `https://github.com/${ref.owner}/${ref.repo}`;
				branch = input.branch?.trim() || ref.branch || null;
			} catch (e) {
				throw new BadRequestException((e as Error).message);
			}
		}
		const project = await this.projects.save(
			this.projects.create({
				workspaceId: workspaceOf(user),
				createdBy: user.id,
				name,
				description: input.description?.trim().slice(0, 2000) || null,
				sourceType: input.sourceType,
				sourceUrl,
				branch,
				status: input.sourceType === 'github' ? 'importing' : 'draft',
				statusMessage: input.sourceType === 'github' ? 'Queued' : 'Waiting for a ZIP upload',
				progress: 0,
			}),
		);
		await this.log(user, 'project.create', project.id, { sourceType: input.sourceType });
		if (input.sourceType === 'github') {
			const token = input.githubToken?.trim() || undefined;
			void this.runPipeline(project.id, async () => {
				const ref = parseGithubUrl(project.sourceUrl!);
				ref.branch = project.branch || undefined;
				const dl = await downloadGithubZip(ref, token);
				return { zip: dl.zip, commitSha: dl.commitSha, branch: dl.branch };
			});
		}
		return project;
	}

	async importZip(user: PmUser, id: string, zip: Buffer) {
		const p = await this.require(user, id);
		if (p.status === 'importing' || p.status === 'analyzing') throw new ConflictException('An import is already running for this project.');
		if (!zip?.length) throw new BadRequestException('Upload a .zip file.');
		if (zip.length > PM_LIMITS.maxZipBytes) throw new HttpException('The ZIP file is too large.', HttpStatus.PAYLOAD_TOO_LARGE);
		if (zip.subarray(0, 2).toString('latin1') !== 'PK') throw new BadRequestException('The file is not a ZIP archive.');
		await this.projects.update(p.id, { status: 'importing', statusMessage: 'Queued', progress: 0 });
		await this.log(user, 'project.import_zip', p.id, { bytes: zip.length });
		void this.runPipeline(p.id, async () => ({ zip, commitSha: null, branch: p.branch }));
		return this.projects.findOneByOrFail({ id: p.id });
	}

	async reimport(user: PmUser, id: string, githubToken?: string) {
		const p = await this.require(user, id);
		if (p.sourceType !== 'github') throw new BadRequestException('Only GitHub projects can be re-synced. Upload a new ZIP instead.');
		if (p.status === 'importing' || p.status === 'analyzing') throw new ConflictException('An import is already running for this project.');
		await this.projects.update(p.id, { status: 'importing', statusMessage: 'Queued', progress: 0 });
		await this.log(user, 'project.resync', p.id);
		void this.runPipeline(p.id, async () => {
			const ref = parseGithubUrl(p.sourceUrl!);
			ref.branch = p.branch || undefined;
			const dl = await downloadGithubZip(ref, githubToken?.trim() || undefined);
			return { zip: dl.zip, commitSha: dl.commitSha, branch: dl.branch };
		});
		return this.projects.findOneByOrFail({ id: p.id });
	}

	async remove(user: PmUser, id: string) {
		const p = await this.require(user, id);
		await this.projects.softDelete(p.id);
		await this.log(user, 'project.delete', p.id);
		return { ok: true };
	}

	private async acquire() {
		if (this.running >= PM_LIMITS.maxConcurrentJobs) await new Promise<void>((r) => this.waiters.push(r));
		this.running++;
	}
	private release() {
		this.running--;
		this.waiters.shift()?.();
	}

	private async setProgress(id: string, status: string, progress: number, message: string) {
		await this.projects.update(id, { status, progress, statusMessage: message });
	}

	/** import → analyze → persist → ready. Every failure ends in status=failed with a user-safe message. */
	private async runPipeline(projectId: string, source: () => Promise<{ zip: Buffer; commitSha: string | null; branch: string | null }>) {
		await this.acquire();
		try {
			await this.setProgress(projectId, 'importing', 10, 'Downloading and unpacking');
			const src = await source();
			const raw = await extractZip(src.zip);
			await this.setProgress(projectId, 'analyzing', 40, `Analyzing ${raw.length} files`);
			const { files, analysis } = analyzeFiles(raw);
			await this.setProgress(projectId, 'analyzing', 65, 'Saving index');
			const chunkCount = await this.persist(projectId, files);
			const languages = analysis.languages;
			const indexed = files.filter((f) => !f.excluded).length;
			await this.projects.update(projectId, {
				status: 'ready',
				progress: 100,
				statusMessage: null,
				fileCount: files.length,
				chunkCount,
				totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
				languages,
				analysis: { ...analysis, indexedFiles: indexed },
				commitSha: src.commitSha,
				branch: src.branch ?? undefined,
				analyzedAt: new Date(),
			} as any);
			await this.docs.regenerateStructural(projectId);
			await this.gaps.syncAuto(projectId);
		} catch (e: any) {
			const message = this.safePipelineMessage(e);
			this.logger.warn(`pipeline failed for ${projectId}: ${e?.message}`);
			await this.projects.update(projectId, { status: 'failed', statusMessage: message, progress: 0 }).catch(() => undefined);
		} finally {
			this.release();
		}
	}

	private safePipelineMessage(e: unknown): string {
		if (e instanceof ArchiveError || e instanceof GithubImportError) return e.message;
		return 'Import failed unexpectedly. Check the file and try again.';
	}

	private async persist(projectId: string, files: AnalyzedFile[]): Promise<number> {
		let chunkTotal = 0;
		await this.ds.transaction(async (m) => {
			await m.query('DELETE FROM pm_chunks WHERE project_id = $1', [projectId]);
			await m.query('DELETE FROM pm_files WHERE project_id = $1', [projectId]);
			const B = 200;
			for (let i = 0; i < files.length; i += B) {
				const batch = files.slice(i, i + B);
				const rows = await m
					.createQueryBuilder()
					.insert()
					.into(PmFile)
					.values(
						batch.map((f) => ({
							projectId,
							path: f.path,
							language: f.language,
							sizeBytes: f.sizeBytes,
							lineCount: f.lineCount,
							content: f.content,
							excluded: f.excluded,
							excludeReason: f.excludeReason,
							symbols: f.symbols as any,
							imports: f.imports as any,
						})),
					)
					.returning(['id', 'path'])
					.execute();
				const idByPath = new Map<string, string>((rows.raw as Array<{ id: string; path: string }>).map((r) => [r.path, r.id]));
				const chunkRows: Array<Record<string, unknown>> = [];
				for (const f of batch) {
					const fileId = idByPath.get(f.path);
					if (!fileId) continue;
					for (const c of f.chunks) chunkRows.push({ projectId, fileId, path: f.path, startLine: c.startLine, endLine: c.endLine, text: c.text, symbols: c.symbols });
				}
				for (let j = 0; j < chunkRows.length; j += 400) {
					await m.createQueryBuilder().insert().into('pm_chunks').values(chunkRows.slice(j, j + 400) as any).execute();
				}
				chunkTotal += chunkRows.length;
			}
		});
		return chunkTotal;
	}

	/* ---------------------------- explorer ---------------------------- */

	async tree(user: PmUser, id: string) {
		await this.require(user, id);
		return this.files.find({
			where: { projectId: id },
			select: ['path', 'language', 'sizeBytes', 'lineCount', 'excluded', 'excludeReason'],
			order: { path: 'ASC' },
		});
	}

	async file(user: PmUser, id: string, path: string) {
		await this.require(user, id);
		const f = await this.files.findOne({ where: { projectId: id, path: String(path || '') } });
		if (!f) throw new NotFoundException('File not found in this project');
		const all = await this.files.find({ where: { projectId: id }, select: ['path', 'imports'] });
		const allPaths = new Set(all.map((x) => x.path));
		const importedBy = all.filter((o) => o.path !== f.path && (o.imports || []).some((spec) => resolveImport(o.path, spec, allPaths) === f.path)).map((o) => o.path).slice(0, 100);
		const imports = (f.imports || []).map((spec) => ({ spec, resolved: resolveImport(f.path, spec, allPaths) }));
		return {
			path: f.path,
			language: f.language,
			sizeBytes: f.sizeBytes,
			lineCount: f.lineCount,
			excluded: f.excluded,
			excludeReason: f.excludeReason,
			content: f.content,
			symbols: f.symbols,
			imports,
			importedBy,
		};
	}

	async search(user: PmUser, id: string, terms: string[]) {
		await this.require(user, id);
		return this.retrieval.retrieve(id, terms, 20);
	}

	/* ---------------------------- dashboard ---------------------------- */

	async dashboard(user: PmUser, id: string) {
		const p = await this.require(user, id);
		const analysis = (p.analysis || {}) as Partial<ProjectAnalysis> & { indexedFiles?: number };
		const [gapRows, convCount, recent, meetings, docRows, sims] = await Promise.all([
			this.ds.query(`SELECT status, priority, count(*)::int AS n FROM pm_knowledge_gaps WHERE project_id = $1 GROUP BY status, priority`, [id]),
			this.ds.query(`SELECT count(*)::int AS n FROM pm_messages m JOIN pm_conversations c ON c.id = m.conversation_id WHERE c.project_id = $1 AND m.role = 'user'`, [id]),
			this.ds.query(
				`SELECT m.content, m.created_at AS "createdAt", c.id AS "conversationId" FROM pm_messages m JOIN pm_conversations c ON c.id = m.conversation_id
				  WHERE c.project_id = $1 AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 5`,
				[id],
			),
			this.ds.query(`SELECT id, title, scheduled_at AS "scheduledAt", status FROM pm_meetings WHERE project_id = $1 AND status <> 'done' ORDER BY scheduled_at NULLS LAST LIMIT 3`, [id]),
			this.ds.query(`SELECT key, verification, origin, commit_sha AS "commitSha" FROM pm_doc_sections WHERE project_id = $1`, [id]),
			this.ds.query(`SELECT total_score AS "totalScore", created_at AS "createdAt" FROM pm_sim_sessions WHERE project_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 8`, [id]),
		]);
		const openGaps = (gapRows as any[]).filter((g) => g.status !== 'resolved').reduce((s, g) => s + g.n, 0);
		const totalGaps = (gapRows as any[]).reduce((s, g) => s + g.n, 0);
		const topGaps = await this.ds.query(
			`SELECT id, title, priority, status FROM pm_knowledge_gaps WHERE project_id = $1 AND status <> 'resolved'
			  ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at LIMIT 5`,
			[id],
		);
		const docsStale = !!p.commitSha && (docRows as any[]).some((d) => d.commitSha && d.commitSha !== p.commitSha);
		const knowledgeCoverage = totalGaps ? Math.round((((gapRows as any[]).filter((g) => ['understood', 'documented', 'resolved'].includes(g.status)).reduce((s, g) => s + g.n, 0)) / totalGaps) * 100) : null;
		return {
			project: { id: p.id, name: p.name, status: p.status, statusMessage: p.statusMessage, progress: p.progress, analyzedAt: p.analyzedAt, commitSha: p.commitSha, sourceType: p.sourceType, sourceUrl: p.sourceUrl },
			counts: { files: p.fileCount, indexedFiles: analysis.indexedFiles ?? 0, chunks: p.chunkCount, routes: analysis.routes?.length ?? 0, entities: (analysis.entities?.length ?? 0) + (analysis.tables?.length ?? 0), questions: convCount[0]?.n ?? 0, openGaps },
			languages: p.languages,
			coverage: {
				documentation: { value: analysis.documentationCoverage ?? null, method: analysis.documentationCoverageMethod ?? null },
				knowledge: { value: knowledgeCoverage, method: 'Share of knowledge gaps that are Understood, Documented or Resolved. Null until gaps exist.' },
			},
			docsStale,
			recentQuestions: recent,
			upcomingMeetings: meetings,
			topGaps,
			simulatorTrend: [...sims].reverse(),
			sync: { sourceType: p.sourceType, lastSyncedAt: p.analyzedAt, commitSha: p.commitSha },
			nextStep: this.nextStep(p, convCount[0]?.n ?? 0),
		};
	}

	private nextStep(p: PmProject, questions: number): { key: string } {
		if (p.status === 'failed') return { key: 'fix_import' };
		if (p.status === 'draft') return { key: 'upload_zip' };
		if (p.status !== 'ready') return { key: 'wait_analysis' };
		if (questions === 0) return { key: 'ask_first_question' };
		return { key: 'review_gaps' };
	}

	async deleteProjectsFor(ids: string[]) {
		return this.projects.delete({ id: In(ids) });
	}
}
