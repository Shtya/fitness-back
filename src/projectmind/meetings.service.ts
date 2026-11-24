import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiJsonService } from './ai-json.service';
import { PmKnowledgeGap, PmMeeting, PmMeetingNote, PmProject } from './entities/projectmind.entities';
import { NOTE_KINDS } from './projectmind.constants';
import { PmUser, workspaceOf } from './projects.service';

/** Honest capture status. No speech-to-text source is wired to meetings, so live transcription is never active. */
export const TRANSCRIPTION_STATUS = {
	liveTranscription: { available: false, enabled: false, reason: 'No speech-to-text source is configured for ProjectMind meetings. Notes are typed manually.' },
	recording: { active: false, note: 'ProjectMind does not record audio or video.' },
	consentReminder: 'Always tell meeting participants before any recording or transcription starts.',
} as const;

@Injectable()
export class MeetingsService {
	constructor(
		@InjectRepository(PmMeeting) private readonly meetings: Repository<PmMeeting>,
		@InjectRepository(PmMeetingNote) private readonly notes: Repository<PmMeetingNote>,
		@InjectRepository(PmKnowledgeGap) private readonly gaps: Repository<PmKnowledgeGap>,
		private readonly aiJson: AiJsonService,
	) {}

	list(user: PmUser, projectId: string) {
		return this.meetings.find({ where: { projectId, workspaceId: workspaceOf(user) }, order: { scheduledAt: 'DESC', createdAt: 'DESC' }, take: 100 });
	}

	async create(user: PmUser, projectId: string, input: { title: string; scheduledAt?: string }) {
		const title = String(input.title || '').trim();
		if (title.length < 2 || title.length > 200) throw new BadRequestException('Title must be 2-200 characters.');
		let scheduledAt: Date | null = null;
		if (input.scheduledAt) {
			scheduledAt = new Date(input.scheduledAt);
			if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('scheduledAt is not a valid date.');
		}
		return this.meetings.save(this.meetings.create({ projectId, workspaceId: workspaceOf(user), userId: user.id, title, scheduledAt }));
	}

	private async require(user: PmUser, projectId: string, id: string) {
		const m = await this.meetings.findOne({ where: { id, projectId, workspaceId: workspaceOf(user) } });
		if (!m) throw new NotFoundException('Meeting not found');
		return m;
	}

	async get(user: PmUser, projectId: string, id: string) {
		const m = await this.require(user, projectId, id);
		return { meeting: m, notes: await this.notes.find({ where: { meetingId: id }, order: { createdAt: 'ASC' } }), transcription: TRANSCRIPTION_STATUS };
	}

	async setStatus(user: PmUser, projectId: string, id: string, status: string) {
		if (!['planned', 'live', 'done'].includes(status)) throw new BadRequestException('status must be planned, live or done');
		const m = await this.require(user, projectId, id);
		m.status = status;
		return this.meetings.save(m);
	}

	async remove(user: PmUser, projectId: string, id: string) {
		const m = await this.require(user, projectId, id);
		await this.meetings.delete(m.id);
		return { ok: true };
	}

	async addNote(user: PmUser, projectId: string, id: string, input: { kind: string; body: string }) {
		await this.require(user, projectId, id);
		if (!(NOTE_KINDS as readonly string[]).includes(input.kind)) throw new BadRequestException(`kind must be one of ${NOTE_KINDS.join(', ')}`);
		const body = String(input.body || '').trim();
		if (!body || body.length > 8000) throw new BadRequestException('Note body is required (max 8000 characters).');
		return this.notes.save(this.notes.create({ meetingId: id, kind: input.kind, body }));
	}

	async removeNote(user: PmUser, projectId: string, id: string, noteId: string) {
		await this.require(user, projectId, id);
		const r = await this.notes.delete({ id: noteId, meetingId: id });
		if (!r.affected) throw new NotFoundException('Note not found');
		return { ok: true };
	}

	/**
	 * Prep: the "limitations" and "open gaps" parts are deterministic (real data). Likely/difficult questions
	 * and decisions need the AI provider; if it is unavailable they are omitted and the reason is returned.
	 */
	async prep(user: PmUser, project: PmProject, id: string) {
		const m = await this.require(user, project.id, id);
		const openGaps = await this.gaps.find({ where: { projectId: project.id }, order: { priority: 'ASC' }, take: 50 });
		const unresolved = openGaps.filter((g) => g.status !== 'resolved');
		const limitations = unresolved.filter((g) => g.priority === 'critical' || g.priority === 'high').map((g) => g.title);
		const prep: Record<string, any> = { limitations, openGapCount: unresolved.length, generatedAt: new Date().toISOString() };
		const a = project.analysis || {};
		try {
			const obj = await this.aiJson.object(
				user,
				'You prepare someone for a project meeting. Reply with ONE JSON object only: {"likelyQuestions":["..."],"difficultQuestions":["..."],"decisionsToSeek":["..."]}. Max 6 items each. Base everything on the facts given; do not invent features.',
				[
					`Meeting: ${m.title}`,
					`Project: ${project.name}`,
					`Areas: ${(a.modules || []).slice(0, 8).map((x: any) => x.name).join(', ')}`,
					`Routes detected: ${(a.routes || []).length}; entities/tables: ${(a.entities || []).length + (a.tables || []).length}; test files: ${a.testFiles ?? 0}`,
					`Known weaknesses: ${limitations.join('; ') || 'none recorded'}`,
				].join('\n'),
				900,
			);
			if (obj) {
				const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 300)).slice(0, 6) : []);
				prep.likelyQuestions = arr(obj.likelyQuestions);
				prep.difficultQuestions = arr(obj.difficultQuestions);
				prep.decisionsToSeek = arr(obj.decisionsToSeek);
			} else prep.aiUnavailableReason = 'The AI provider returned an unreadable reply.';
		} catch (e: any) {
			prep.aiUnavailableReason = e?.aiCode === 'AI_NOT_CONFIGURED' ? 'No AI provider key is configured, so question suggestions were not generated.' : 'The AI provider could not be reached.';
		}
		m.prep = prep;
		await this.meetings.save(m);
		return prep;
	}
}
