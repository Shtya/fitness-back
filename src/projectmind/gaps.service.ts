import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PmFile, PmKnowledgeGap, PmProject } from './entities/projectmind.entities';
import { GAP_PRIORITIES, GAP_STATUSES, GapPriority, GapStatus } from './projectmind.constants';

interface AutoGap {
	dedupeKey: string;
	title: string;
	description: string;
	priority: GapPriority;
	relatedFiles: string[];
}

/** Deterministic gap detection from the analysis. Pure so it can be unit-tested. */
export function detectAutoGaps(analysis: Record<string, any>, filePaths: string[]): AutoGap[] {
	const gaps: AutoGap[] = [];
	const docFiles: string[] = analysis.docFiles || [];
	const testFiles: number = analysis.testFiles || 0;
	const modules: Array<{ name: string; files: number }> = analysis.modules || [];
	const secretFiles: string[] = analysis.secretFiles || [];

	if (!docFiles.some((p) => /(^|\/)readme(\.\w+)?$/i.test(p))) {
		gaps.push({ dedupeKey: 'no-readme', title: 'No README found', description: 'The repository has no README, so setup and purpose are undocumented.', priority: 'high', relatedFiles: [] });
	}
	if (testFiles === 0) {
		gaps.push({ dedupeKey: 'no-tests', title: 'No automated tests detected', description: 'No *.spec / *.test files or tests/ folders were found. Behaviour cannot be confirmed by tests.', priority: 'high', relatedFiles: [] });
	}
	if (secretFiles.length > 0) {
		gaps.push({
			dedupeKey: 'hardcoded-secrets',
			title: `Secret-looking values found in ${secretFiles.length} source file(s)`,
			description: 'Values that look like keys/passwords/tokens were found in source and redacted from the index. Rotate them if real and move them to environment variables.',
			priority: 'critical',
			relatedFiles: secretFiles.slice(0, 20),
		});
	}
	const hasEnvExample = filePaths.some((p) => /(^|\/)\.env\.(example|sample|template)$/i.test(p));
	if (!hasEnvExample && (analysis.configFiles || []).length > 0) {
		gaps.push({ dedupeKey: 'no-env-example', title: 'No .env.example template', description: 'Required environment variables are not documented in a template file.', priority: 'medium', relatedFiles: [] });
	}
	const controllers = filePaths.filter((p) => /\.controller\.[jt]s$/.test(p));
	const untested = controllers.filter((p) => !filePaths.includes(p.replace(/\.controller\.([jt]s)$/, '.controller.spec.$1')) && !filePaths.includes(p.replace(/\.controller\.([jt]s)$/, '.controller.test.$1')));
	if (controllers.length > 0 && untested.length > 0) {
		gaps.push({ dedupeKey: 'untested-controllers', title: `${untested.length} of ${controllers.length} controllers have no spec file`, description: 'API handlers without a sibling spec/test file.', priority: untested.length === controllers.length ? 'high' : 'medium', relatedFiles: untested.slice(0, 20) });
	}
	for (const m of modules.slice(0, 40)) {
		if (m.name === '(root)' || m.files < 4) continue;
		const hasDoc = docFiles.some((d) => d.startsWith(m.name + '/'));
		if (!hasDoc) {
			gaps.push({ dedupeKey: `undocumented:${m.name}`.slice(0, 200), title: `Module "${m.name}" has no documentation`, description: `${m.files} files under ${m.name}/ and no markdown/text documentation inside it.`, priority: m.files >= 15 ? 'high' : 'medium', relatedFiles: filePaths.filter((p) => p.startsWith(m.name + '/')).slice(0, 10) });
		}
	}
	return gaps;
}

@Injectable()
export class GapsService {
	constructor(
		@InjectRepository(PmKnowledgeGap) private readonly gaps: Repository<PmKnowledgeGap>,
		@InjectRepository(PmProject) private readonly projects: Repository<PmProject>,
		@InjectRepository(PmFile) private readonly files: Repository<PmFile>,
	) {}

	/** Adds newly detected gaps, keeps user-set status/priority, removes auto gaps that no longer apply (only if untouched). */
	async syncAuto(projectId: string) {
		const p = await this.projects.findOne({ where: { id: projectId } });
		if (!p) return;
		const paths = (await this.files.find({ where: { projectId }, select: ['path'] })).map((f) => f.path);
		const detected = detectAutoGaps(p.analysis || {}, paths);
		const existing = await this.gaps.find({ where: { projectId, source: 'auto' } });
		const byKey = new Map(existing.map((g) => [g.dedupeKey, g]));
		for (const d of detected) {
			const cur = byKey.get(d.dedupeKey);
			if (cur) {
				cur.title = d.title;
				cur.description = d.description;
				cur.relatedFiles = d.relatedFiles;
				await this.gaps.save(cur);
			} else {
				await this.gaps.save(this.gaps.create({ projectId, ...d, status: 'not_started', source: 'auto' }));
			}
		}
		const keep = new Set(detected.map((d) => d.dedupeKey));
		for (const g of existing) if (!keep.has(g.dedupeKey) && g.status === 'not_started') await this.gaps.delete(g.id);
	}

	list(projectId: string, filter: { status?: string; priority?: string } = {}) {
		const where: Record<string, string> = { projectId };
		if (filter.status && (GAP_STATUSES as readonly string[]).includes(filter.status)) where.status = filter.status;
		if (filter.priority && (GAP_PRIORITIES as readonly string[]).includes(filter.priority)) where.priority = filter.priority;
		return this.gaps.find({ where, order: { updatedAt: 'DESC' } });
	}

	async create(projectId: string, input: { title: string; description?: string; priority?: string; relatedFiles?: string[] }) {
		const title = String(input.title || '').trim();
		if (title.length < 3 || title.length > 300) throw new BadRequestException('Title must be 3-300 characters.');
		const priority = (GAP_PRIORITIES as readonly string[]).includes(String(input.priority)) ? String(input.priority) : 'medium';
		return this.gaps.save(
			this.gaps.create({
				projectId,
				dedupeKey: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
				title,
				description: input.description?.slice(0, 4000) || null,
				priority,
				status: 'not_started',
				source: 'manual',
				relatedFiles: (input.relatedFiles || []).slice(0, 30).map(String),
			}),
		);
	}

	async update(projectId: string, gapId: string, patch: { status?: string; priority?: string; description?: string; title?: string }) {
		const g = await this.gaps.findOne({ where: { id: gapId, projectId } });
		if (!g) throw new NotFoundException('Gap not found');
		if (patch.status !== undefined) {
			if (!(GAP_STATUSES as readonly string[]).includes(patch.status)) throw new BadRequestException(`status must be one of ${GAP_STATUSES.join(', ')}`);
			g.status = patch.status as GapStatus;
		}
		if (patch.priority !== undefined) {
			if (!(GAP_PRIORITIES as readonly string[]).includes(patch.priority)) throw new BadRequestException(`priority must be one of ${GAP_PRIORITIES.join(', ')}`);
			g.priority = patch.priority;
		}
		if (patch.description !== undefined) g.description = String(patch.description).slice(0, 4000);
		if (patch.title !== undefined && String(patch.title).trim().length >= 3) g.title = String(patch.title).trim().slice(0, 300);
		return this.gaps.save(g);
	}

	async remove(projectId: string, gapId: string) {
		const r = await this.gaps.delete({ id: gapId, projectId, source: 'manual' as any });
		if (!r.affected) throw new BadRequestException('Only manually created gaps can be deleted. Mark detected gaps as Resolved instead.');
		return { ok: true };
	}

	/** Pre-meeting checklist: open gaps ordered by priority, as Markdown. */
	async checklist(projectId: string) {
		const open = (await this.list(projectId)).filter((g) => g.status !== 'resolved');
		const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
		open.sort((a, b) => rank[a.priority] - rank[b.priority]);
		const md = open.length
			? open.map((g) => `- [ ] **${g.priority.toUpperCase()}** — ${g.title}${g.relatedFiles?.length ? ` _(${g.relatedFiles.slice(0, 3).join(', ')})_` : ''}`).join('\n')
			: '_No open knowledge gaps._';
		return { markdown: md, items: open.length };
	}
}
