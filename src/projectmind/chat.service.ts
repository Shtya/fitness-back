import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { AiException } from '../ai/ai.errors';
import { buildChatPrompt, CHAT_SYSTEM_PROMPT } from './chat/prompt';
import { ConfidenceInfo, heuristicConfidence, parseModelJson, SourceRef, validateAnswer } from './chat/citations';
import { evidenceGate, extractTerms, isSecretExtractionAttempt, retrievalQuery } from './chat/query';
import { PmConversation, PmMessage, PmProject } from './entities/projectmind.entities';
import { AnswerStyle, ANSWER_STYLES, INSUFFICIENT_EVIDENCE_TEXT, PM_AI_FEATURE, PM_LIMITS } from './projectmind.constants';
import { PmUser, workspaceOf } from './projects.service';
import { RetrievalService } from './retrieval.service';

export type AnswerStatus = 'answered' | 'insufficient_evidence' | 'blocked' | 'provider_error' | 'not_ready';

export interface AskResult {
	status: AnswerStatus;
	conversationId: string;
	messageId: string;
	answer: string;
	claims: Array<{ text: string; label: string; sources: number[]; downgraded?: boolean }>;
	sources: SourceRef[];
	/** Sources retrieved when the provider failed, so the user still gets real code references. */
	retrievedOnly?: SourceRef[];
	confidence: ConfidenceInfo | null;
	notes: string[];
	providerError?: { code: string; message: string };
	meta: { model?: string; latencyMs: number; retrieved: number; coverage: number };
}

const BLOCKED_TEXT = 'I will not reveal secrets, credentials or the contents of excluded files. Secret files are never indexed. You can ask how secrets are stored, loaded or protected in the code instead.';

@Injectable()
export class ChatService {
	constructor(
		@InjectRepository(PmConversation) private readonly convs: Repository<PmConversation>,
		@InjectRepository(PmMessage) private readonly msgs: Repository<PmMessage>,
		private readonly retrieval: RetrievalService,
		private readonly ai: AiService,
	) {}

	async listConversations(user: PmUser, projectId: string) {
		return this.convs.find({ where: { projectId, workspaceId: workspaceOf(user), userId: user.id }, order: { updatedAt: 'DESC' }, take: 100 });
	}

	async messages(user: PmUser, projectId: string, conversationId: string) {
		const c = await this.convs.findOne({ where: { id: conversationId, projectId, workspaceId: workspaceOf(user), userId: user.id } });
		if (!c) throw new NotFoundException('Conversation not found');
		return { conversation: c, messages: await this.msgs.find({ where: { conversationId }, order: { createdAt: 'ASC' } }) };
	}

	async removeConversation(user: PmUser, projectId: string, conversationId: string) {
		const r = await this.convs.delete({ id: conversationId, projectId, workspaceId: workspaceOf(user), userId: user.id });
		if (!r.affected) throw new NotFoundException('Conversation not found');
		return { ok: true };
	}

	async ask(user: PmUser, project: PmProject, input: { question: string; conversationId?: string; style?: string }): Promise<AskResult> {
		const started = Date.now();
		const question = String(input.question || '').trim();
		if (!question) throw new BadRequestException('Question is required.');
		if (question.length > PM_LIMITS.maxQuestionChars) throw new BadRequestException(`Question is too long (max ${PM_LIMITS.maxQuestionChars} characters).`);
		const style = (ANSWER_STYLES as readonly string[]).includes(String(input.style)) ? (input.style as AnswerStyle) : undefined;

		const conv = await this.getOrCreateConversation(user, project, input.conversationId, question);
		const history = (await this.msgs.find({ where: { conversationId: conv.id }, order: { createdAt: 'ASC' }, take: 40 })).map((m) => ({ role: m.role, content: m.content }));
		await this.msgs.save(this.msgs.create({ conversationId: conv.id, role: 'user', content: question }));
		const base = { conversationId: conv.id };
		const elapsed = (extra: Partial<AskResult['meta']> = {}) => ({ latencyMs: Date.now() - started, retrieved: 0, coverage: 0, ...extra });

		const finish = async (r: Omit<AskResult, 'messageId' | 'conversationId'>): Promise<AskResult> => {
			const saved = await this.msgs.save(
				this.msgs.create({ conversationId: conv.id, role: 'assistant', content: r.answer, meta: { status: r.status, claims: r.claims, sources: r.sources, retrievedOnly: r.retrievedOnly, confidence: r.confidence, notes: r.notes, providerError: r.providerError, ...r.meta, style } }),
			);
			await this.convs.update(conv.id, { updatedAt: new Date() });
			return { ...r, ...base, messageId: saved.id };
		};

		if (project.status !== 'ready') {
			return finish({ status: 'not_ready', answer: 'This project is not ready yet. Wait for the import and analysis to finish.', claims: [], sources: [], confidence: null, notes: [], meta: elapsed() });
		}
		if (isSecretExtractionAttempt(question)) {
			return finish({ status: 'blocked', answer: BLOCKED_TEXT, claims: [], sources: [], confidence: null, notes: ['Secret-extraction request refused before retrieval.'], meta: elapsed() });
		}

		const prevUser = history.filter((m) => m.role === 'user').map((m) => m.content);
		const terms = extractTerms(retrievalQuery(question, prevUser));
		const chunks = await this.retrieval.retrieve(project.id, terms);
		const gate = evidenceGate(terms, chunks);
		if (!gate.sufficient) {
			return finish({ status: 'insufficient_evidence', answer: INSUFFICIENT_EVIDENCE_TEXT, claims: [], sources: [], confidence: { level: 'low', heuristic: true, basis: gate.reason }, notes: [gate.reason], meta: elapsed({ retrieved: chunks.length, coverage: gate.coverage }) });
		}

		const asSources: SourceRef[] = chunks.map((c, i) => ({ n: i + 1, path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: c.text.slice(0, 600) }));
		let text = '';
		let model: string | undefined;
		try {
			const res: any = await this.ai.generateText({
				prompt: buildChatPrompt({ question, chunks, history, style }),
				system: CHAT_SYSTEM_PROMPT,
				feature: PM_AI_FEATURE as any,
				user,
				maxTokens: 1800,
				temperature: 0.1,
			});
			text = String(res?.text || '');
			model = res?.model;
		} catch (e: any) {
			const code = e instanceof AiException ? e.aiCode : 'AI_PROVIDER_ERROR';
			const message = e instanceof AiException ? e.message : 'The AI provider failed. Try again.';
			return finish({
				status: 'provider_error',
				answer: code === 'AI_NOT_CONFIGURED' ? 'No AI provider key is configured for this workspace, so no answer was generated. The code below was retrieved for your question.' : `The AI provider could not answer: ${message}`,
				claims: [],
				sources: [],
				retrievedOnly: asSources,
				confidence: null,
				notes: [],
				providerError: { code, message },
				meta: elapsed({ retrieved: chunks.length, coverage: gate.coverage }),
			});
		}

		const v = validateAnswer(parseModelJson(text), chunks, await this.retrieval.knownPaths(project.id));
		return finish({
			status: v.refused ? 'insufficient_evidence' : 'answered',
			answer: v.answer,
			claims: v.claims,
			sources: v.sources,
			confidence: heuristicConfidence(v, gate.coverage),
			notes: v.notes,
			meta: elapsed({ model, retrieved: chunks.length, coverage: gate.coverage }),
		});
	}

	private async getOrCreateConversation(user: PmUser, project: PmProject, id: string | undefined, question: string) {
		if (id) {
			const c = await this.convs.findOne({ where: { id, projectId: project.id, workspaceId: workspaceOf(user), userId: user.id } });
			if (!c) throw new NotFoundException('Conversation not found');
			return c;
		}
		return this.convs.save(this.convs.create({ projectId: project.id, workspaceId: workspaceOf(user), userId: user.id, title: question.slice(0, 80) }));
	}
}
