import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { buildChatPrompt, CHAT_SYSTEM_PROMPT } from './chat/prompt';
import { heuristicConfidence, parseModelJson, validateAnswer } from './chat/citations';
import { evidenceGate, extractTerms } from './chat/query';
import { buildStructuralSections, parseEnvVarNames, parsePackageJson } from './docs-builder';
import { PmDocSection, PmFile, PmProject } from './entities/projectmind.entities';
import { INSUFFICIENT_EVIDENCE_TEXT, PM_AI_FEATURE } from './projectmind.constants';
import { RetrievalService } from './retrieval.service';

export const AI_SECTION_PROMPTS: Record<string, { title: string; question: string }> = {
	'ai-overview': { title: 'Overview (AI summary)', question: 'Summarize what this project does, its main components and how they fit together.' },
	'ai-auth': { title: 'Authentication and authorization (AI)', question: 'How do authentication and authorization work? Cover login, tokens/sessions, password hashing and where access control is enforced.' },
	'ai-data-flow': { title: 'Request and data flow (AI)', question: 'Describe the lifecycle of a typical request from the frontend to the database, naming the files involved.' },
	'ai-integrations': { title: 'External integrations (AI)', question: 'Which external services and third-party APIs does this project integrate with, and where?' },
	'ai-errors': { title: 'Error handling (AI)', question: 'How are errors handled and surfaced to users?' },
};

@Injectable()
export class DocsService {
	constructor(
		@InjectRepository(PmDocSection) private readonly sections: Repository<PmDocSection>,
		@InjectRepository(PmProject) private readonly projects: Repository<PmProject>,
		@InjectRepository(PmFile) private readonly files: Repository<PmFile>,
		private readonly retrieval: RetrievalService,
		private readonly ai: AiService,
	) {}

	/** Rebuilds the deterministic sections. Human-edited sections are never overwritten. */
	async regenerateStructural(projectId: string) {
		const p = await this.projects.findOne({ where: { id: projectId } });
		if (!p) return;
		const cfg = await this.files.find({ where: { projectId, excluded: false }, select: ['path', 'content'] });
		const envNames = new Set<string>();
		const packages: Array<{ path: string; dependencies: string[]; scripts: string[] }> = [];
		for (const f of cfg) {
			if (/(^|\/)\.env\.(example|sample|template)$/i.test(f.path) && f.content) parseEnvVarNames(f.content).forEach((n) => envNames.add(n));
			if (/(^|\/)package\.json$/.test(f.path) && f.content) {
				const pj = parsePackageJson(f.content);
				if (pj) packages.push({ path: f.path, ...pj });
			}
		}
		const drafts = buildStructuralSections({
			name: p.name,
			description: p.description,
			sourceUrl: p.sourceUrl,
			commitSha: p.commitSha,
			analysis: p.analysis || {},
			envVarNames: [...envNames],
			packages,
			fileCount: p.fileCount,
		});
		for (const d of drafts) {
			const cur = await this.sections.findOne({ where: { projectId, key: d.key } });
			if (cur?.origin === 'edited') continue;
			await this.sections.save(
				this.sections.create({ ...(cur || {}), projectId, key: d.key, title: d.title, contentMd: d.contentMd, origin: 'generated', verification: 'verified', commitSha: p.commitSha, generatedAt: new Date() }),
			);
		}
	}

	async list(projectId: string) {
		const p = await this.projects.findOne({ where: { id: projectId } });
		const rows = await this.sections.find({ where: { projectId }, order: { key: 'ASC' } });
		return rows.map((s) => ({ ...s, stale: !!p?.commitSha && !!s.commitSha && s.commitSha !== p.commitSha, lastAnalyzedCommit: s.commitSha }));
	}

	async update(projectId: string, key: string, contentMd: string) {
		const s = await this.sections.findOne({ where: { projectId, key } });
		if (!s) throw new NotFoundException('Section not found');
		if (typeof contentMd !== 'string' || contentMd.length > 200_000) throw new BadRequestException('contentMd is required and must be under 200 KB.');
		s.contentMd = contentMd;
		s.origin = 'edited';
		s.verification = 'unverified';
		return this.sections.save(s);
	}

	/** Re-generates one structural section, discarding manual edits to it (explicit user action). */
	async resetStructural(projectId: string, key: string) {
		const s = await this.sections.findOne({ where: { projectId, key } });
		if (!s) throw new NotFoundException('Section not found');
		if (s.origin === 'edited') {
			s.origin = 'generated';
			await this.sections.save(s);
		}
		await this.regenerateStructural(projectId);
		return this.sections.findOneByOrFail({ projectId, key });
	}

	/** AI-written section, grounded in retrieved code and passed through the same citation validation as chat. */
	async generateAi(user: any, projectId: string, key: string) {
		const spec = AI_SECTION_PROMPTS[key];
		if (!spec) throw new BadRequestException(`Unknown AI section. Use one of: ${Object.keys(AI_SECTION_PROMPTS).join(', ')}`);
		const p = await this.projects.findOneOrFail({ where: { id: projectId } });
		const terms = extractTerms(spec.question);
		const chunks = await this.retrieval.retrieve(projectId, terms, 10);
		const gate = evidenceGate(terms, chunks);
		let md: string;
		let verification: 'verified' | 'inferred' | 'unverified' = 'unverified';
		if (!gate.sufficient) {
			md = `# ${spec.title}\n\n${INSUFFICIENT_EVIDENCE_TEXT}`;
		} else {
			const res = await this.ai.generateText({ prompt: buildChatPrompt({ question: spec.question, chunks, history: [] }), system: CHAT_SYSTEM_PROMPT, feature: PM_AI_FEATURE as any, user, maxTokens: 2000, temperature: 0.1 });
			const v = validateAnswer(parseModelJson((res as any).text), chunks, await this.retrieval.knownPaths(projectId));
			const refs = v.sources.map((s) => `- [${s.n}] \`${s.path}:${s.startLine}-${s.endLine}\``).join('\n');
			md = `# ${spec.title}\n\n${v.answer}${refs ? `\n\n## Sources\n\n${refs}` : ''}`;
			verification = v.refused ? 'unverified' : heuristicConfidence(v, gate.coverage).level === 'high' ? 'verified' : 'inferred';
		}
		const cur = await this.sections.findOne({ where: { projectId, key } });
		return this.sections.save(this.sections.create({ ...(cur || {}), projectId, key, title: spec.title, contentMd: md, origin: 'ai', verification, commitSha: p.commitSha, generatedAt: new Date() }));
	}

	async exportMarkdown(projectId: string): Promise<string> {
		const p = await this.projects.findOneOrFail({ where: { id: projectId } });
		const rows = await this.sections.find({ where: { projectId } });
		const order = ['overview', 'architecture', 'api', 'database', 'setup', 'testing', 'security'];
		rows.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99) || a.key.localeCompare(b.key));
		const head = `<!-- ${p.name} · generated by ProjectMind · commit ${p.commitSha || 'n/a'} -->\n\n`;
		return head + rows.map((r) => `${r.contentMd}\n\n_Status: ${r.verification} · origin: ${r.origin}_`).join('\n\n---\n\n');
	}
}
