import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../entities/global.entity';
import {
	OpenLeadConversationDto,
	OpenMetaPhoneDto,
	SetMetaConversationFavoriteDto,
	CreateMetaTemplateDto,
	EditMetaTemplateDto,
	SaveMetaWhatsAppConfigDto,
	SendMetaTemplateDto,
	SendMetaTextDto,
	StartMetaBulkDto,
	CheckMetaBulkPhonesDto,
	CreateFromMetaLibraryDto,
	CloneMetaTemplatesDto,
	CreateMetaQuickReplyDto,
	UpdateMetaQuickReplyDto,
	TranslateMetaTextDto,
} from '../dto/meta-whatsapp.dto';
import { MetaWhatsAppConfigService } from '../services/meta-whatsapp-config.service';
import { MetaWhatsAppConversationsService } from '../services/meta-whatsapp-conversations.service';
import { MetaWhatsAppMessagingService } from '../services/meta-whatsapp-messaging.service';
import { MetaWhatsAppBulkService } from '../services/meta-whatsapp-bulk.service';
import { MetaWhatsAppActivityService } from '../services/meta-whatsapp-activity.service';
import { MetaWhatsAppMediaService } from '../services/meta-whatsapp-media.service';
import { MetaWhatsAppCloudApiService } from '../services/meta-whatsapp-cloud-api.service';
import { MetaWhatsAppUsageBillingService } from '../services/meta-whatsapp-usage-billing.service';
import { MetaWhatsAppQuickRepliesService } from '../services/meta-whatsapp-quick-replies.service';
import { MetaWhatsAppTranslateService } from '../services/meta-whatsapp-translate.service';

@Controller('meta-whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MetaWhatsAppController {
	constructor(
		private readonly config: MetaWhatsAppConfigService,
		private readonly conversations: MetaWhatsAppConversationsService,
		private readonly messaging: MetaWhatsAppMessagingService,
		private readonly bulk: MetaWhatsAppBulkService,
		private readonly activity: MetaWhatsAppActivityService,
		private readonly media: MetaWhatsAppMediaService,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
		private readonly usageBilling: MetaWhatsAppUsageBillingService,
		private readonly quickReplies: MetaWhatsAppQuickRepliesService,
		private readonly translateService: MetaWhatsAppTranslateService,
	) {}

	private uid(req: any): string {
		const id = req?.user?.id;
		if (!id) throw new BadRequestException('Authenticated user is required');
		return id;
	}

	@Get('status')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	status(@Req() req: any) {
		return this.config.getPublicStatus(this.uid(req));
	}

	@Get('usage-billing')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	getUsageBilling(@Req() req: any) {
		return this.usageBilling.getDashboard(req.user?.id);
	}

	@Put('config')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	saveConfig(@Req() req: any, @Body() dto: SaveMetaWhatsAppConfigDto) {
		return this.config.save(req.user?.id, dto);
	}

	@Post('config/validate')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	validate(@Req() req: any) {
		return this.config.validate(req.user?.id);
	}

	@Post('config/enable')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	enable(@Req() req: any, @Body() body: { enabled?: boolean }) {
		return this.config.setEnabled(req.user?.id, Boolean(body?.enabled));
	}

	@Get('templates')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	templates(@Req() req: any) {
		return this.config.listTemplates(this.uid(req));
	}

	@Get('templates/seed')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	listSeedTemplates() {
		return this.config.listSeedTemplates();
	}

	@Post('templates/seed')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	submitSeedTemplates(@Req() req: any, @Body() body: { keys?: string[] }) {
		return this.config.submitSeedTemplates(req.user?.id, body?.keys);
	}

	@Post('templates/clone')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	cloneTemplates(@Req() req: any, @Body() dto: CloneMetaTemplatesDto) {
		return this.config.cloneTemplatesAsCategory(req.user?.id, dto);
	}

	@Get('templates/library')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	listTemplateLibrary(
		@Req() req: any,
		@Query('search') search?: string,
		@Query('language') language?: string,
	) {
		return this.config.listTemplateLibrary(req.user?.id, { search, language });
	}

	@Post('templates/from-library')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	createFromLibrary(@Req() req: any, @Body() dto: CreateFromMetaLibraryDto) {
		return this.config.createFromLibrary(req.user?.id, dto);
	}

	@Post('templates/upload-header')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	@UseInterceptors(
		FileInterceptor('file', {
			storage: memoryStorage(),
			limits: { fileSize: 16 * 1024 * 1024 },
		}),
	)
	uploadTemplateHeader(@Req() req: any, @UploadedFile() file: any) {
		if (!file?.buffer?.length) throw new BadRequestException('file is required');
		return this.config.uploadTemplateHeader(req.user?.id, file);
	}

	@Post('templates')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	createTemplate(@Req() req: any, @Body() dto: CreateMetaTemplateDto) {
		return this.config.createTemplate(req.user?.id, dto);
	}

	@Put('templates/:templateId')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	updateTemplate(
		@Req() req: any,
		@Param('templateId') templateId: string,
		@Body() dto: EditMetaTemplateDto,
	) {
		return this.config.updateTemplate(req.user?.id, templateId, dto);
	}

	@Delete('templates')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	deleteTemplate(
		@Req() req: any,
		@Query('name') name?: string,
		@Query('hsmId') hsmId?: string,
		@Body() body?: { name?: string; hsmId?: string },
	) {
		return this.config.deleteTemplate(req.user?.id, {
			name: name || body?.name,
			hsmId: hsmId || body?.hsmId,
		});
	}

	@Get('activity')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async activityLogs(@Req() req: any, @Query('limit') limit?: string) {
		const cfg = await this.config.getOrCreate(this.uid(req));
		return this.activity.list(cfg.id, limit ? Number(limit) : 50);
	}

	@Get('conversations')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listConversations(
		@Req() req: any,
		@Query('q') q?: string,
		@Query('limit') limit?: string,
		@Query('filter') filter?: string,
	) {
		return this.conversations.list(this.uid(req), q, limit ? Number(limit) : 50, filter);
	}

	@Get('conversations/counts')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	conversationFilterCounts(@Req() req: any) {
		return this.conversations.filterCounts(this.uid(req));
	}

	@Post('conversations/open-phone')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	openPhone(@Req() req: any, @Body() dto: OpenMetaPhoneDto) {
		return this.conversations.openByPhone(this.uid(req), dto.phone, dto.displayName);
	}

	@Get('conversations/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	getConversation(@Req() req: any, @Param('id') id: string) {
		return this.conversations.get(this.uid(req), id);
	}

	@Get('conversations/:id/messages')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	messages(
		@Req() req: any,
		@Param('id') id: string,
		@Query('limit') limit?: string,
		@Query('before') before?: string,
	) {
		return this.conversations.messages(this.uid(req), id, limit ? Number(limit) : 100, before);
	}

	@Post('conversations/:id/read')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async markRead(@Req() req: any, @Param('id') id: string) {
		const userId = this.uid(req);
		const result = await this.conversations.markRead(userId, id);
		if (result.lastInboundWamid) {
			try {
				const runtime = await this.config.requireRuntime(userId, { requireEnabled: true });
				await this.cloudApi.markAsRead(
					runtime.secrets.accessToken,
					runtime.config.phoneNumberId!,
					result.lastInboundWamid,
				);
			} catch {
				/* local unread cleared even if Meta read receipt fails */
			}
		}
		return result.conversation;
	}

	@Post('conversations/:id/sync')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async syncConversation(@Req() req: any, @Param('id') id: string) {
		const userId = this.uid(req);
		const conversation = await this.conversations.get(userId, id);
		const payload = await this.conversations.messages(userId, id, 200);
		const messages = Array.isArray(payload) ? payload : payload?.messages || [];
		return {
			conversation: {
				...conversation,
				canSendFreeform: payload?.canSendFreeform ?? conversation.canSendFreeform,
				withinCustomerCareWindow:
					payload?.withinCustomerCareWindow ?? conversation.withinCustomerCareWindow,
				requiresTemplate: payload?.requiresTemplate ?? conversation.requiresTemplate,
				lastInboundAt: payload?.lastInboundAt ?? conversation.lastInboundAt,
			},
			messages,
			messageCount: messages.length,
			syncedFromDb: true,
			metaHistoryNote:
				'Meta Cloud API cannot import WhatsApp history from before the webhook. Synced from this system database.',
		};
	}

	@Put('conversations/:id/favorite')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	setConversationFavorite(
		@Req() req: any,
		@Param('id') id: string,
		@Body() dto: SetMetaConversationFavoriteDto,
	) {
		return this.conversations.setFavorite(this.uid(req), id, dto.isFavorite);
	}

	@Post('leads/open')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	openLead(@Req() req: any, @Body() dto: OpenLeadConversationDto) {
		return this.conversations.openForLead(this.uid(req), dto.leadId);
	}

	@Post('messages/text')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	sendText(@Req() req: any, @Body() dto: SendMetaTextDto) {
		return this.messaging.sendText(req.user?.id, dto);
	}

	@Post('messages/template')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	sendTemplate(@Req() req: any, @Body() dto: SendMetaTemplateDto) {
		return this.messaging.sendTemplate(req.user?.id, dto);
	}

	@Post('messages/media')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	@UseInterceptors(
		FileInterceptor('file', {
			storage: memoryStorage(),
			limits: { fileSize: 16 * 1024 * 1024 },
		}),
	)
	sendMedia(
		@Req() req: any,
		@UploadedFile() file: any,
		@Body()
		body: {
			conversationId?: string;
			leadId?: string;
			phone?: string;
			caption?: string;
			asVoice?: string;
		},
	) {
		if (!file?.buffer?.length) throw new BadRequestException('file is required');
		return this.messaging.sendMediaFile(req.user?.id, {
			conversationId: body.conversationId,
			leadId: body.leadId,
			phone: body.phone,
			caption: body.caption,
			buffer: file.buffer,
			mimeType: file.mimetype,
			fileName: file.originalname || 'file',
			asVoice: body.asVoice === '1' || body.asVoice === 'true',
		});
	}

	@Get('messages/:id/media')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async getMedia(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
		const media = await this.media.resolveMessageMedia(this.uid(req), id);
		res.setHeader('Content-Type', media.mimeType);
		res.setHeader(
			'Content-Disposition',
			`inline; filename="${encodeURIComponent(media.fileName)}"`,
		);
		res.setHeader('Cache-Control', 'private, max-age=3600');
		return res.send(media.buffer);
	}

	@Post('bulk')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	startBulk(@Req() req: any, @Body() dto: StartMetaBulkDto) {
		return this.bulk.start(req.user?.id, dto);
	}

	@Post('bulk/check-phones')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	checkBulkPhones(@Req() req: any, @Body() dto: CheckMetaBulkPhonesDto) {
		return this.bulk.checkPhones(this.uid(req), dto);
	}

	@Get('bulk')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async listBulk(@Req() req: any, @Query('limit') limit?: string) {
		return this.bulk.listJobs(this.uid(req), limit ? Number(limit) : 30);
	}

	@Get('bulk/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async getBulk(@Req() req: any, @Param('id') id: string) {
		const cfg = await this.config.getOrCreate(this.uid(req));
		return this.bulk.getJob(id, cfg.id);
	}

	@Post('bulk/:id/cancel')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	cancelBulk(@Req() req: any, @Param('id') id: string) {
		return this.bulk.cancel(req.user?.id, id);
	}

	@Get('quick-replies')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listQuickReplies(@Req() req: any) {
		return this.quickReplies.list(req.user?.id);
	}

	@Post('quick-replies')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	createQuickReply(@Req() req: any, @Body() dto: CreateMetaQuickReplyDto) {
		return this.quickReplies.create(req.user?.id, dto);
	}

	@Put('quick-replies/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	updateQuickReply(
		@Req() req: any,
		@Param('id') id: string,
		@Body() dto: UpdateMetaQuickReplyDto,
	) {
		return this.quickReplies.update(this.uid(req), id, dto);
	}

	@Delete('quick-replies/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	deleteQuickReply(@Req() req: any, @Param('id') id: string) {
		return this.quickReplies.remove(this.uid(req), id);
	}

	@Post('translate')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	translateText(@Body() dto: TranslateMetaTextDto) {
		const target =
			dto.targetLang === 'ar' || dto.targetLang === 'en' ? dto.targetLang : undefined;
		return this.translateService.translate(dto.text, target);
	}
}
