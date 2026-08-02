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

	@Get('status')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	status() {
		return this.config.getPublicStatus();
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
	templates() {
		return this.config.listTemplates();
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
	activityLogs(@Query('limit') limit?: string) {
		return this.activity.list(limit ? Number(limit) : 50);
	}

	@Get('conversations')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listConversations(
		@Query('q') q?: string,
		@Query('limit') limit?: string,
		@Query('filter') filter?: string,
	) {
		return this.conversations.list(q, limit ? Number(limit) : 50, filter);
	}

	@Get('conversations/counts')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	conversationFilterCounts() {
		return this.conversations.filterCounts();
	}

	@Post('conversations/open-phone')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	openPhone(@Body() dto: OpenMetaPhoneDto) {
		return this.conversations.openByPhone(dto.phone, dto.displayName);
	}

	@Get('conversations/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	getConversation(@Param('id') id: string) {
		return this.conversations.get(id);
	}

	@Get('conversations/:id/messages')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	messages(
		@Param('id') id: string,
		@Query('limit') limit?: string,
		@Query('before') before?: string,
	) {
		return this.conversations.messages(id, limit ? Number(limit) : 100, before);
	}

	@Post('conversations/:id/read')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	async markRead(@Param('id') id: string) {
		const result = await this.conversations.markRead(id);
		if (result.lastInboundWamid) {
			try {
				const runtime = await this.config.requireRuntime({ requireEnabled: true });
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
	async syncConversation(@Param('id') id: string) {
		const conversation = await this.conversations.get(id);
		const messages = await this.conversations.messages(id, 200);
		return {
			conversation,
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
		@Param('id') id: string,
		@Body() dto: SetMetaConversationFavoriteDto,
	) {
		return this.conversations.setFavorite(id, dto.isFavorite);
	}

	@Post('leads/open')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	openLead(@Body() dto: OpenLeadConversationDto) {
		return this.conversations.openForLead(dto.leadId);
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
	async getMedia(@Param('id') id: string, @Res() res: Response) {
		const media = await this.media.resolveMessageMedia(id);
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
	checkBulkPhones(@Body() dto: CheckMetaBulkPhonesDto) {
		return this.bulk.checkPhones(dto);
	}

	@Get('bulk')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listBulk(@Query('limit') limit?: string) {
		return this.bulk.listJobs(limit ? Number(limit) : 30);
	}

	@Get('bulk/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	getBulk(@Param('id') id: string) {
		return this.bulk.getJob(id);
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
	updateQuickReply(@Param('id') id: string, @Body() dto: UpdateMetaQuickReplyDto) {
		return this.quickReplies.update(id, dto);
	}

	@Delete('quick-replies/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	deleteQuickReply(@Param('id') id: string) {
		return this.quickReplies.remove(id);
	}

	@Post('translate')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	translateText(@Body() dto: TranslateMetaTextDto) {
		const target =
			dto.targetLang === 'ar' || dto.targetLang === 'en' ? dto.targetLang : undefined;
		return this.translateService.translate(dto.text, target);
	}
}
