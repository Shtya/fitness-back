import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	AgentTestDto,
	SendAgentSuggestionDto,
	SetConversationAgentModeDto,
	UpdateAiAgentSettingsDto,
	UpsertExternalModelDto,
	UpsertKnowledgeEntryDto,
} from '../dto/ai-agent.dto';
import { AiAgentService } from './ai-agent.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiAgentController {
	constructor(private readonly agent: AiAgentService) {}

	@Get('accounts/:accountId/ai-agent/settings')
	getSettings(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.agent.getSettings(req.user, accountId);
	}

	@Put('accounts/:accountId/ai-agent/settings')
	updateSettings(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: UpdateAiAgentSettingsDto,
	) {
		return this.agent.updateSettings(req.user, accountId, body);
	}

	@Get('accounts/:accountId/ai-agent/catalog')
	catalog() {
		return this.agent.catalog();
	}

	@Get('accounts/:accountId/ai-agent/models')
	listExternalModels(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.agent.listExternalModels(req.user, accountId);
	}

	@Post('accounts/:accountId/ai-agent/models')
	createExternalModel(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: UpsertExternalModelDto,
	) {
		return this.agent.createExternalModel(req.user, accountId, body);
	}

	@Put('accounts/:accountId/ai-agent/models/:id')
	updateExternalModel(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('id', ParseUUIDPipe) id: string,
		@Body() body: UpsertExternalModelDto,
	) {
		return this.agent.updateExternalModel(req.user, accountId, id, body);
	}

	@Delete('accounts/:accountId/ai-agent/models/:id')
	deleteExternalModel(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('id', ParseUUIDPipe) id: string,
	) {
		return this.agent.deleteExternalModel(req.user, accountId, id);
	}

	@Post('accounts/:accountId/ai-agent/models/:id/test')
	testExternalModel(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('id', ParseUUIDPipe) id: string,
	) {
		return this.agent.testExternalModel(req.user, accountId, id);
	}

	@Get('accounts/:accountId/ai-agent/knowledge')
	listKnowledge(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.agent.listKnowledge(req.user, accountId);
	}

	@Post('accounts/:accountId/ai-agent/knowledge')
	createKnowledge(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: UpsertKnowledgeEntryDto,
	) {
		return this.agent.createKnowledge(req.user, accountId, body);
	}

	@Put('accounts/:accountId/ai-agent/knowledge/:id')
	updateKnowledge(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('id', ParseUUIDPipe) id: string,
		@Body() body: UpsertKnowledgeEntryDto,
	) {
		return this.agent.updateKnowledge(req.user, accountId, id, body);
	}

	@Delete('accounts/:accountId/ai-agent/knowledge/:id')
	deleteKnowledge(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('id', ParseUUIDPipe) id: string,
	) {
		return this.agent.deleteKnowledge(req.user, accountId, id);
	}

	@Post('accounts/:accountId/ai-agent/test')
	test(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: AgentTestDto,
	) {
		return this.agent.test(req.user, accountId, body);
	}

	@Get('accounts/:accountId/ai-agent/conversations')
	listConversationStates(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.agent.listConversationStates(req.user, accountId);
	}

	@Get('accounts/:accountId/ai-agent/runs')
	listRuns(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Query('limit') limit?: string,
	) {
		return this.agent.listRuns(req.user, accountId, Number(limit) || 50);
	}

	@Get('conversations/:conversationId/ai-agent')
	getConversation(@Req() req: any, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
		return this.agent.getConversation(req.user, conversationId);
	}

	@Put('conversations/:conversationId/ai-agent')
	setMode(
		@Req() req: any,
		@Param('conversationId', ParseUUIDPipe) conversationId: string,
		@Body() body: SetConversationAgentModeDto,
	) {
		return this.agent.setConversationMode(req.user, conversationId, body);
	}

	@Post('conversations/:conversationId/ai-agent/resume')
	resume(@Req() req: any, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
		return this.agent.resume(req.user, conversationId);
	}

	@Post('conversations/:conversationId/ai-agent/suggestion/send')
	sendSuggestion(
		@Req() req: any,
		@Param('conversationId', ParseUUIDPipe) conversationId: string,
		@Body() body: SendAgentSuggestionDto,
	) {
		return this.agent.sendSuggestion(req.user, conversationId, body);
	}

	@Delete('conversations/:conversationId/ai-agent/suggestion')
	dismissSuggestion(@Req() req: any, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
		return this.agent.dismissSuggestion(req.user, conversationId);
	}

	@Delete('conversations/:conversationId/ai-agent/memory')
	clearMemory(@Req() req: any, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
		return this.agent.clearMemory(req.user, conversationId);
	}
}
