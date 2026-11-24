import { BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from 'entities/global.entity';
import { AiService } from '../ai/ai.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { ChatService } from './chat.service';
import { extractTerms } from './chat/query';
import { DocsService, AI_SECTION_PROMPTS } from './docs.service';
import { GapsService } from './gaps.service';
import { MeetingsService, TRANSCRIPTION_STATUS } from './meetings.service';
import { PM_LIMITS, ANSWER_STYLES, GAP_PRIORITIES, GAP_STATUSES, NOTE_KINDS, SIM_DIFFICULTIES, SIM_SCENARIOS } from './projectmind.constants';
import { ProjectsService, PmUser, workspaceOf } from './projects.service';
import { RateLimiter } from './rate-limiter';
import { SettingsService } from './settings.service';
import { SimulatorService } from './simulator.service';

/**
 * ProjectMind HTTP API. Every route is authenticated (JWT), limited to staff roles, and scoped to the caller's
 * workspace: a project id from another workspace answers 404, exactly like a non-existent id.
 */
@Controller('projectmind')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
export class ProjectMindController {
	private readonly limiter = new RateLimiter();

	constructor(
		private readonly projects: ProjectsService,
		private readonly chat: ChatService,
		private readonly docs: DocsService,
		private readonly gaps: GapsService,
		private readonly meetings: MeetingsService,
		private readonly sim: SimulatorService,
		private readonly ai: AiService,
		private readonly settings: SettingsService,
	) {}

	private limit(req: any, bucket: string, max: number, windowMs: number) {
		if (!this.limiter.take(`${bucket}:${req.user.id}`, max, windowMs)) {
			throw new HttpException('Too many requests. Please slow down.', HttpStatus.TOO_MANY_REQUESTS);
		}
	}

	/* ------------------------------ meta ------------------------------ */

	@Get('meta')
	meta() {
		return {
			limits: { maxZipBytes: PM_LIMITS.maxZipBytes, maxQuestionChars: PM_LIMITS.maxQuestionChars },
			answerStyles: ANSWER_STYLES,
			gapStatuses: GAP_STATUSES,
			gapPriorities: GAP_PRIORITIES,
			noteKinds: NOTE_KINDS,
			simScenarios: SIM_SCENARIOS,
			simDifficulties: SIM_DIFFICULTIES,
			aiSections: Object.entries(AI_SECTION_PROMPTS).map(([key, v]) => ({ key, title: v.title })),
			transcription: TRANSCRIPTION_STATUS,
		};
	}

	/** Whether the workspace has an AI provider key. Never returns key material. */
	@Get('ai-status')
	async aiStatus(@Req() req: any) {
		try {
			const o: any = await this.ai.overview(req.user);
			const providers = (o.providers || []).map((p: any) => ({ id: p.id, name: p.name, needsKey: !!p.needsKey, configured: !!p.credential?.configured }));
			return { configured: providers.some((p: any) => p.needsKey && p.configured), providers };
		} catch {
			return { configured: false, providers: [] };
		}
	}

	/* ----------------------------- settings ----------------------------- */

	/** Saved GitHub token status. The token itself is never returned. */
	@Get('settings/github-token')
	githubTokenStatus(@Req() req: any) {
		return this.settings.githubStatus(workspaceOf(req.user));
	}

	@Put('settings/github-token')
	async saveGithubToken(@Req() req: any, @Body() body: any) {
		this.limit(req, 'settings', 20, 10 * 60_000);
		const r = await this.settings.saveGithubToken(workspaceOf(req.user), req.user.id, body?.token);
		await this.projects.log(req.user, 'settings.github_token_saved', null);
		return r;
	}

	@Delete('settings/github-token')
	async removeGithubToken(@Req() req: any) {
		await this.projects.log(req.user, 'settings.github_token_removed', null);
		return this.settings.removeGithubToken(workspaceOf(req.user));
	}

	/* ----------------------------- projects ----------------------------- */

	@Get('projects')
	list(@Req() req: any) {
		return this.projects.list(req.user as PmUser);
	}

	@Post('projects')
	create(@Req() req: any, @Body() body: any) {
		this.limit(req, 'create', 20, 10 * 60_000);
		return this.projects.create(req.user, {
			name: body?.name,
			description: body?.description,
			sourceType: body?.sourceType,
			sourceUrl: body?.sourceUrl,
			branch: body?.branch,
			githubToken: body?.githubToken,
		});
	}

	@Get('projects/:id')
	get(@Req() req: any, @Param('id') id: string) {
		return this.projects.require(req.user, id);
	}

	@Delete('projects/:id')
	remove(@Req() req: any, @Param('id') id: string) {
		return this.projects.remove(req.user, id);
	}

	@Post('projects/:id/import')
	@UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: PM_LIMITS.maxZipBytes, files: 1 } }))
	importZip(@Req() req: any, @Param('id') id: string, @UploadedFile() file?: { buffer: Buffer; originalname?: string }) {
		this.limit(req, 'import', 6, 10 * 60_000);
		if (!file?.buffer) throw new BadRequestException('Attach the ZIP as multipart field "file".');
		return this.projects.importZip(req.user, id, file.buffer);
	}

	@Post('projects/:id/resync')
	resync(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		this.limit(req, 'import', 6, 10 * 60_000);
		return this.projects.reimport(req.user, id, body?.githubToken);
	}

	@Get('projects/:id/dashboard')
	dashboard(@Req() req: any, @Param('id') id: string) {
		return this.projects.dashboard(req.user, id);
	}

	/* ----------------------------- explorer ----------------------------- */

	@Get('projects/:id/tree')
	tree(@Req() req: any, @Param('id') id: string) {
		return this.projects.tree(req.user, id);
	}

	@Get('projects/:id/file')
	file(@Req() req: any, @Param('id') id: string, @Query('path') path: string) {
		if (!path || path.length > 1000) throw new BadRequestException('path is required');
		return this.projects.file(req.user, id, path);
	}

	@Get('projects/:id/search')
	async search(@Req() req: any, @Param('id') id: string, @Query('q') q: string) {
		const terms = extractTerms(String(q || '').slice(0, 300));
		return this.projects.search(req.user, id, terms);
	}

	/* ------------------------------- chat ------------------------------- */

	@Post('projects/:id/ask')
	async ask(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		this.limit(req, 'ask', 30, 60_000);
		const project = await this.projects.require(req.user, id);
		return this.chat.ask(req.user, project, { question: body?.question, conversationId: body?.conversationId, style: body?.style });
	}

	/** Retrieval + evidence-gate preview (no AI call, nothing stored). Used by the evaluation harness. */
	@Post('projects/:id/retrieve')
	async retrieve(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		this.limit(req, 'retrieve', 600, 60_000);
		const project = await this.projects.require(req.user, id);
		return this.chat.retrievalPreview(project, { question: body?.question, previousQuestions: Array.isArray(body?.previousQuestions) ? body.previousQuestions : [] });
	}

	@Get('projects/:id/conversations')
	async conversations(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.chat.listConversations(req.user, id);
	}

	@Get('projects/:id/conversations/:cid')
	async conversation(@Req() req: any, @Param('id') id: string, @Param('cid') cid: string) {
		await this.projects.require(req.user, id);
		return this.chat.messages(req.user, id, cid);
	}

	@Delete('projects/:id/conversations/:cid')
	async deleteConversation(@Req() req: any, @Param('id') id: string, @Param('cid') cid: string) {
		await this.projects.require(req.user, id);
		return this.chat.removeConversation(req.user, id, cid);
	}

	/* -------------------------------- docs -------------------------------- */

	@Get('projects/:id/docs')
	async docList(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.docs.list(id);
	}

	@Get('projects/:id/docs-export')
	async docExport(@Req() req: any, @Param('id') id: string) {
		const p = await this.projects.require(req.user, id);
		return { filename: `${p.name.replace(/[^\w.-]+/g, '_')}-documentation.md`, markdown: await this.docs.exportMarkdown(id) };
	}

	@Put('projects/:id/docs/:key')
	async docUpdate(@Req() req: any, @Param('id') id: string, @Param('key') key: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		await this.projects.log(req.user, 'docs.edit', id, { key });
		return this.docs.update(id, key, body?.contentMd);
	}

	@Post('projects/:id/docs/:key/reset')
	async docReset(@Req() req: any, @Param('id') id: string, @Param('key') key: string) {
		await this.projects.require(req.user, id);
		return this.docs.resetStructural(id, key);
	}

	@Post('projects/:id/docs/ai/:key')
	async docAi(@Req() req: any, @Param('id') id: string, @Param('key') key: string) {
		this.limit(req, 'ask', 30, 60_000);
		await this.projects.require(req.user, id);
		return this.docs.generateAi(req.user, id, key);
	}

	/* -------------------------------- gaps -------------------------------- */

	@Get('projects/:id/gaps')
	async gapList(@Req() req: any, @Param('id') id: string, @Query('status') status?: string, @Query('priority') priority?: string) {
		await this.projects.require(req.user, id);
		return this.gaps.list(id, { status, priority });
	}

	@Get('projects/:id/gaps-checklist')
	async gapChecklist(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.gaps.checklist(id);
	}

	@Post('projects/:id/gaps')
	async gapCreate(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		return this.gaps.create(id, body || {});
	}

	@Patch('projects/:id/gaps/:gid')
	async gapUpdate(@Req() req: any, @Param('id') id: string, @Param('gid') gid: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		return this.gaps.update(id, gid, body || {});
	}

	@Delete('projects/:id/gaps/:gid')
	async gapDelete(@Req() req: any, @Param('id') id: string, @Param('gid') gid: string) {
		await this.projects.require(req.user, id);
		return this.gaps.remove(id, gid);
	}

	@Post('projects/:id/gaps-rescan')
	async gapRescan(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		await this.gaps.syncAuto(id);
		return this.gaps.list(id);
	}

	/* ------------------------------ meetings ------------------------------ */

	@Get('transcription-status')
	transcription() {
		return TRANSCRIPTION_STATUS;
	}

	@Get('projects/:id/meetings')
	async meetingList(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.meetings.list(req.user, id);
	}

	@Post('projects/:id/meetings')
	async meetingCreate(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		return this.meetings.create(req.user, id, body || {});
	}

	@Get('projects/:id/meetings/:mid')
	async meetingGet(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string) {
		await this.projects.require(req.user, id);
		return this.meetings.get(req.user, id, mid);
	}

	@Patch('projects/:id/meetings/:mid')
	async meetingStatus(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		return this.meetings.setStatus(req.user, id, mid, body?.status);
	}

	@Delete('projects/:id/meetings/:mid')
	async meetingDelete(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string) {
		await this.projects.require(req.user, id);
		return this.meetings.remove(req.user, id, mid);
	}

	@Post('projects/:id/meetings/:mid/prep')
	async meetingPrep(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string) {
		this.limit(req, 'ask', 30, 60_000);
		const p = await this.projects.require(req.user, id);
		return this.meetings.prep(req.user, p, mid);
	}

	@Post('projects/:id/meetings/:mid/notes')
	async noteAdd(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string, @Body() body: any) {
		await this.projects.require(req.user, id);
		return this.meetings.addNote(req.user, id, mid, body || {});
	}

	@Delete('projects/:id/meetings/:mid/notes/:nid')
	async noteDelete(@Req() req: any, @Param('id') id: string, @Param('mid') mid: string, @Param('nid') nid: string) {
		await this.projects.require(req.user, id);
		return this.meetings.removeNote(req.user, id, mid, nid);
	}

	/* ----------------------------- simulator ----------------------------- */

	@Get('projects/:id/simulator/sessions')
	async simList(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.sim.list(req.user, id);
	}

	@Get('projects/:id/simulator/trend')
	async simTrend(@Req() req: any, @Param('id') id: string) {
		await this.projects.require(req.user, id);
		return this.sim.trend(req.user, id);
	}

	@Post('projects/:id/simulator/sessions')
	async simStart(@Req() req: any, @Param('id') id: string, @Body() body: any) {
		this.limit(req, 'ask', 30, 60_000);
		const p = await this.projects.require(req.user, id);
		return this.sim.start(req.user, p, { scenario: body?.scenario, difficulty: body?.difficulty });
	}

	@Get('projects/:id/simulator/sessions/:sid')
	async simGet(@Req() req: any, @Param('id') id: string, @Param('sid') sid: string) {
		await this.projects.require(req.user, id);
		return this.sim.get(req.user, id, sid);
	}

	@Post('projects/:id/simulator/sessions/:sid/answer')
	async simAnswer(@Req() req: any, @Param('id') id: string, @Param('sid') sid: string, @Body() body: any) {
		this.limit(req, 'ask', 30, 60_000);
		const p = await this.projects.require(req.user, id);
		return this.sim.answer(req.user, p, sid, { answer: body?.answer });
	}
}
