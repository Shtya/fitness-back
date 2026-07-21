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
	StreamableFile,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppConversationNoteDto,
	DeleteWhatsAppMessageDto,
	ForwardWhatsAppMessageDto,
	ReactWhatsAppMessageDto,
	SendWhatsAppMessageDto,
	ToggleWhatsAppMessageDto,
} from '../dto/whatsapp.dto';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';

const mediaRoot = () =>
	path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT ||
			path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);

const allowedMediaTypes = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'video/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/ogg;codecs=opus',
	'audio/mp4',
	'audio/webm',
	'audio/webm;codecs=opus',
	'video/webm',
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppConversationsController {
	constructor(
		private readonly sync: WhatsAppSyncService,
		private readonly access: WhatsAppAccessService,
	) {}

	@Get('accounts/:accountId/conversations')
	listConversations(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('page') page = '1',
		@Query('limit') limit = '50',
		@Query('search') search = '',
		@Query('filter') filter = 'all',
		@Query('assignedUserId') assignedUserId = '',
	) {
		return this.sync.listConversations(
			req.user,
			accountId,
			Number(page),
			Number(limit),
			search,
			filter,
			assignedUserId,
		);
	}

	@Put('conversations/:conversationId/favorite')
	setFavorite(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: { isFavorite?: boolean },
	) {
		return this.sync.setConversationFavorite(
			req.user,
			conversationId,
			Boolean(body.isFavorite),
		);
	}

	@Put('conversations/:conversationId/pin')
	setPinned(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: { isPinned?: boolean },
	) {
		return this.sync.setConversationPinned(
			req.user,
			conversationId,
			Boolean(body.isPinned),
		);
	}

	@Post('accounts/:accountId/sync/contacts')
	syncContacts(@Req() req: any, @Param('accountId') accountId: string) {
		return this.sync.syncContacts(req.user, accountId);
	}

	@Post('accounts/:accountId/sync/chats')
	syncChats(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('limit') limit = '100',
	) {
		return this.sync.syncChats(req.user, accountId, Number(limit));
	}

	@Get('accounts/:accountId/groups')
	listGroups(@Req() req: any, @Param('accountId') accountId: string) {
		return this.sync.listGroups(req.user, accountId);
	}

	@Get('accounts/:accountId/groups/:groupId')
	groupDetails(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('groupId') groupId: string,
		@Query('refresh') refresh?: string,
	) {
		return this.sync.getGroupDetails(
			req.user,
			accountId,
			groupId,
			refresh === 'true',
		);
	}

	@Get('conversations/:conversationId/messages')
	listMessages(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('before') before?: string,
		@Query('limit') limit = '30',
	) {
		return this.sync.listMessages(req.user, conversationId, before, Number(limit));
	}

	@Put('conversations/:conversationId/messages/:messageId/reaction')
	reactToMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: ReactWhatsAppMessageDto,
	) {
		return this.sync.reactToMessage(
			req.user,
			conversationId,
			messageId,
			body.emoji,
		);
	}

	@Post('conversations/:conversationId/messages/:messageId/forward')
	forwardMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: ForwardWhatsAppMessageDto,
	) {
		return this.sync.forwardMessage(
			req.user,
			conversationId,
			messageId,
			body.targetConversationId,
		);
	}

	@Put('conversations/:conversationId/messages/:messageId/star')
	starMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: ToggleWhatsAppMessageDto,
	) {
		return this.sync.starMessage(req.user, conversationId, messageId, body.enabled);
	}

	@Put('conversations/:conversationId/messages/:messageId/pin')
	pinMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: ToggleWhatsAppMessageDto,
	) {
		return this.sync.pinMessage(req.user, conversationId, messageId, body.enabled);
	}

	@Delete('conversations/:conversationId/messages/:messageId')
	deleteMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: DeleteWhatsAppMessageDto,
	) {
		return this.sync.deleteMessage(req.user, conversationId, messageId, body.mode);
	}

	@Get('conversations/:conversationId/messages/:messageId/info')
	messageInfo(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
	) {
		return this.sync.getMessageInfo(req.user, conversationId, messageId);
	}

	@Post('conversations/:conversationId/sync/latest')
	syncLatest(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('limit') limit = '30',
	) {
		return this.sync.syncConversation(req.user, conversationId, 'latest', Number(limit));
	}

	@Post('conversations/:conversationId/sync/older')
	syncOlder(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('limit') limit = '30',
	) {
		return this.sync.syncConversation(req.user, conversationId, 'older', Number(limit));
	}

	@Post('conversations/:conversationId/read')
	markRead(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('manual') manual?: string,
	) {
		return this.sync.markConversationRead(req.user, conversationId, manual === 'true');
	}

	@Get('conversations/:conversationId/notes')
	listNotes(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.sync.listConversationNotes(req.user, conversationId);
	}

	@Post('conversations/:conversationId/notes')
	createNote(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: CreateWhatsAppConversationNoteDto,
	) {
		return this.sync.createConversationNote(req.user, conversationId, body.text);
	}

	@Post('conversations/:conversationId/messages')
	send(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SendWhatsAppMessageDto,
	) {
		if (body.type === 'text') {
			if (!body.text?.trim()) throw new BadRequestException('Message text is required');
			return this.sync.sendText(
				req.user,
				conversationId,
				body.text.trim(),
				body.quotedProviderMessageId,
				body.clientMessageId,
			);
		}
		if (!body.fileId) throw new BadRequestException('Media fileId is required');
		return this.sync.sendMedia(req.user, conversationId, {
			type: body.type,
			fileId: body.fileId,
			caption: body.caption,
			quotedProviderMessageId: body.quotedProviderMessageId,
			clientMessageId: body.clientMessageId,
		});
	}

	@Post('accounts/:accountId/media')
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: (req: any, _file, callback) => {
					const destination = path.join(
						mediaRoot(),
						'outgoing',
						String(req.params?.accountId || 'invalid'),
						String(req.user?.id || 'invalid'),
					);
					fs.mkdirSync(destination, { recursive: true });
					callback(null, destination);
				},
				filename: (_req, file, callback) => {
					const extension = path.extname(file.originalname).slice(0, 12);
					const voiceMatch = String(file.originalname || '').match(/voice-(\d+)s/i);
					const voiceTag = voiceMatch ? `-voice-${voiceMatch[1]}s` : '';
					callback(
						null,
						`${Date.now()}-${Math.random().toString(36).slice(2, 10)}${voiceTag}${extension}`,
					);
				},
			}),
			limits: { fileSize: 25 * 1024 * 1024 },
			fileFilter: (_req, file, callback) => {
				const mime = String(file.mimetype || '')
					.toLowerCase()
					.replace(/\s+/g, '');
				const allowed =
					allowedMediaTypes.has(file.mimetype) ||
					allowedMediaTypes.has(mime) ||
					[...allowedMediaTypes].some(
						type => mime === type.replace(/\s+/g, '') || mime.startsWith(`${type};`),
					);
				if (!allowed) {
					return callback(new BadRequestException('Unsupported WhatsApp media type'), false);
				}
				callback(null, true);
			},
		}),
	)
	async upload(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@UploadedFile() file: any,
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canUse');
		if (!file) throw new BadRequestException('File is required');
		return {
			fileId: path.relative(mediaRoot(), file.path).replace(/\\/g, '/'),
			fileName: file.originalname,
			mimeType: file.mimetype,
			size: file.size,
		};
	}

	@Delete('accounts/:accountId/media')
	async deletePendingUpload(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: { fileId?: string },
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canUse');
		if (!body.fileId) throw new BadRequestException('Media fileId is required');
		const userRoot = path.resolve(
			mediaRoot(),
			'outgoing',
			String(accountId),
			String(req.user?.id || 'invalid'),
		);
		const filePath = path.resolve(mediaRoot(), body.fileId);
		if (filePath !== userRoot && !filePath.startsWith(`${userRoot}${path.sep}`)) {
			throw new BadRequestException('Invalid media fileId');
		}
		await fs.promises.rm(filePath, { force: true });
		return { deleted: true };
	}

	@Post('attachments/:attachmentId/download')
	downloadAttachment(@Req() req: any, @Param('attachmentId') attachmentId: string) {
		return this.sync.downloadAttachment(req.user, attachmentId);
	}

	@Get('attachments/:attachmentId/content')
	async streamAttachment(
		@Req() req: any,
		@Param('attachmentId') attachmentId: string,
		@Res({ passthrough: true }) res: Response,
	) {
		const file = await this.sync.resolveAttachmentFile(req.user, attachmentId);
		const safeInlineTypes = new Set([
			'image/jpeg',
			'image/png',
			'image/webp',
			'image/gif',
			'audio/mpeg',
			'audio/ogg',
			'audio/mp4',
			'audio/webm',
			'video/mp4',
			'video/webm',
		]);
		const mimeType = String(file.mimeType || 'application/octet-stream')
			.toLowerCase()
			.split(';')[0];
		const inline = safeInlineTypes.has(mimeType);
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Content-Type', inline ? mimeType : 'application/octet-stream');
		res.setHeader('Cache-Control', 'private, max-age=3600');
		res.setHeader(
			'Content-Disposition',
			`${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.fileName || 'attachment')}"`,
		);
		return new StreamableFile(createReadStream(file.absolutePath));
	}
}
