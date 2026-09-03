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
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { assertSendRateLimit } from '../utils/whatsapp-send-rate-limit';
import {
	CreateWhatsAppConversationNoteDto,
	CreateWhatsAppMessageGroupDto,
	DeleteWhatsAppMessageDto,
	DeleteWhatsAppPendingUploadDto,
	EditWhatsAppMessageDto,
	ForwardWhatsAppMessageDto,
	OpenWhatsAppConversationDto,
	ReactWhatsAppMessageDto,
	RenameWhatsAppMessageGroupDto,
	SendWhatsAppMessageDto,
	SendWhatsAppPresenceDto,
	SetWhatsAppConversationArchivedDto,
	SetWhatsAppConversationFavoriteDto,
	SetWhatsAppConversationMutedDto,
	SetWhatsAppConversationPinnedDto,
	ShareWhatsAppMessagesAsOriginalDto,
	ToggleWhatsAppMessageDto,
	WhatsAppMessageGroupMessagesDto,
} from '../dto/whatsapp.dto';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppMessageGroupsService } from '../services/whatsapp-message-groups.service';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';
import {
	commitConvertedVoiceOgg,
	ensureWhatsAppVoiceOgg,
	looksLikeOutgoingVoiceUpload,
} from '../utils/whatsapp-voice-ogg';
import { signMediaToken, signedMediaPath } from '../utils/whatsapp-media-signed-url';

const mediaRoot = () =>
	path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT ||
			path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);

const allowedMediaTypes = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/bmp',
	'image/x-ms-bmp',
	'image/heic',
	'image/heif',
	'image/tiff',
	'image/x-tiff',
	'video/mp4',
	'video/webm',
	'video/quicktime',
	'video/x-msvideo',
	'video/3gpp',
	'audio/mpeg',
	'audio/ogg',
	'audio/ogg;codecs=opus',
	'audio/mp4',
	'audio/webm',
	'audio/webm;codecs=opus',
	'audio/wav',
	'audio/aac',
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function inferOutgoingMediaMime(originalName: string): string | null {
	const lower = String(originalName || '').toLowerCase();
	if (/\.jpe?g$/i.test(lower)) return 'image/jpeg';
	if (/\.png$/i.test(lower)) return 'image/png';
	if (/\.webp$/i.test(lower)) return 'image/webp';
	if (/\.gif$/i.test(lower)) return 'image/gif';
	if (/\.bmp$/i.test(lower)) return 'image/bmp';
	if (/\.heic$/i.test(lower)) return 'image/heic';
	if (/\.heif$/i.test(lower)) return 'image/heif';
	if (/\.tiff?$/i.test(lower)) return 'image/tiff';
	if (/\.mp4$/i.test(lower)) return 'video/mp4';
	if (/\.webm$/i.test(lower)) return 'video/webm';
	if (/\.mov$/i.test(lower)) return 'video/quicktime';
	if (/\.m4v$/i.test(lower)) return 'video/mp4';
	if (/\.3gp$/i.test(lower)) return 'video/3gpp';
	if (/\.avi$/i.test(lower)) return 'video/x-msvideo';
	if (/\.pdf$/i.test(lower)) return 'application/pdf';
	return null;
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppConversationsController {
	constructor(
		private readonly sync: WhatsAppSyncService,
		private readonly access: WhatsAppAccessService,
		private readonly messageGroups: WhatsAppMessageGroupsService,
	) {}

	@Get('unread')
	unreadTotal(@Req() req: any) {
		return this.access.getUnreadTotal(req.user);
	}

	@Get('accounts/:accountId/conversations')
	listConversations(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('page') page = '1',
		@Query('limit') limit = '50',
		@Query('search') search = '',
		@Query('filter') filter = 'all',
		@Query('assignedUserId') assignedUserId = '',
		@Query('kind') kind = '',
	) {
		return this.sync.listConversations(
			req.user,
			accountId,
			Number(page),
			Number(limit),
			search,
			filter,
			assignedUserId,
			kind,
		);
	}

	@Post('accounts/:accountId/conversations/open')
	openConversation(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: OpenWhatsAppConversationDto,
	) {
		const chatId = String(body?.chatId || '').trim();
		if (!chatId) {
			throw new BadRequestException('chatId is required');
		}
		return this.sync.openConversationByChatId(req.user, accountId, chatId, {
			title: body?.title || null,
		});
	}

	@Put('conversations/:conversationId/favorite')
	setFavorite(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SetWhatsAppConversationFavoriteDto,
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
		@Body() body: SetWhatsAppConversationPinnedDto,
	) {
		return this.sync.setConversationPinned(
			req.user,
			conversationId,
			Boolean(body.isPinned),
		);
	}

	@Put('conversations/:conversationId/archive')
	setArchived(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SetWhatsAppConversationArchivedDto,
	) {
		return this.sync.setConversationArchived(
			req.user,
			conversationId,
			Boolean(body.isArchived),
		);
	}

	@Put('conversations/:conversationId/mute')
	setMuted(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SetWhatsAppConversationMutedDto,
	) {
		let mutedUntil: string | Date | null | undefined = body.mutedUntil;
		if (body.isMuted && body.durationMinutes != null && !mutedUntil) {
			const minutes = Number(body.durationMinutes);
			if (Number.isFinite(minutes) && minutes > 0) {
				mutedUntil = new Date(Date.now() + minutes * 60_000);
			}
		}
		return this.sync.setConversationMuted(
			req.user,
			conversationId,
			Boolean(body.isMuted),
			mutedUntil,
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
		@Query('limit') limit = '500',
	) {
		return this.sync.syncChats(
			req.user,
			accountId,
			Math.min(Math.max(Number(limit) || 500, 1), 2000),
		);
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
		@Query('limit') limit = '100',
		@Query('live') live?: string,
		@Query('starredOnly') starredOnly?: string,
		@Query('importantOnly') importantOnly?: string,
		@Query('q') q?: string,
	) {
		// Opt-in only. Omitting `live` used to default ON and hit the phone on GET.
		const allowLivePull = ['1', 'true', 'yes'].includes(String(live || '').toLowerCase());
		const onlyImportant = ['1', 'true', 'yes'].includes(
			String(starredOnly || importantOnly || '').toLowerCase(),
		);
		return this.sync.listMessages(req.user, conversationId, before, Math.min(Math.max(Number(limit) || 100, 1), 500), {
			allowLivePull: allowLivePull && !onlyImportant && !String(q || '').trim(),
			starredOnly: onlyImportant,
			search: String(q || '').trim() || undefined,
		});
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

	/** Send selected messages as new outbound messages (images/text) — not WhatsApp forward. */
	@Post('conversations/:conversationId/messages/share-as-original')
	shareMessagesAsOriginal(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: ShareWhatsAppMessagesAsOriginalDto,
	) {
		return this.sync.shareMessagesAsOriginal(
			req.user,
			conversationId,
			body.messageIds,
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

	@Get('conversations/:conversationId/messages/:messageId/location')
	messageLocation(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
	) {
		return this.sync.getMessageLocation(req.user, conversationId, messageId);
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
		@Query('limit') limit = '100',
		@Query('force') force?: string,
	) {
		const forceSync = ['1', 'true', 'yes'].includes(String(force || '').toLowerCase());
		return this.sync.syncConversation(req.user, conversationId, 'latest', Number(limit), {
			force: forceSync,
		});
	}

	@Post('conversations/:conversationId/sync/older')
	syncOlder(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('limit') limit = '100',
		@Query('force') force?: string,
	) {
		const forceSync = ['1', 'true', 'yes'].includes(String(force || '').toLowerCase());
		return this.sync.syncConversation(req.user, conversationId, 'older', Number(limit), {
			force: forceSync,
		});
	}

	@Post('conversations/:conversationId/read')
	markRead(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Query('manual') manual?: string,
	) {
		return this.sync.markConversationRead(req.user, conversationId, manual === 'true');
	}

	@Post('conversations/:conversationId/unread')
	markUnread(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.sync.markConversationUnread(req.user, conversationId);
	}

	@Post('conversations/:conversationId/presence')
	sendPresence(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SendWhatsAppPresenceDto,
	) {
		return this.sync.sendConversationPresence(
			req.user,
			conversationId,
			body?.state || 'composing',
		);
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

	@Get('conversations/:conversationId/message-groups')
	listMessageGroups(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.messageGroups.list(req.user, conversationId);
	}

	@Get('conversations/:conversationId/message-groups/membership')
	messageGroupMembership(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.messageGroups.membershipMap(req.user, conversationId);
	}

	@Post('conversations/:conversationId/message-groups')
	createMessageGroup(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: CreateWhatsAppMessageGroupDto,
	) {
		return this.messageGroups.create(req.user, conversationId, body.name);
	}

	@Put('conversations/:conversationId/message-groups/:groupId')
	renameMessageGroup(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('groupId') groupId: string,
		@Body() body: RenameWhatsAppMessageGroupDto,
	) {
		return this.messageGroups.rename(req.user, conversationId, groupId, body.name);
	}

	@Delete('conversations/:conversationId/message-groups/:groupId')
	deleteMessageGroup(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('groupId') groupId: string,
	) {
		return this.messageGroups.remove(req.user, conversationId, groupId);
	}

	@Get('conversations/:conversationId/message-groups/:groupId/messages')
	listMessageGroupMessages(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('groupId') groupId: string,
	) {
		return this.messageGroups.listGroupMessages(req.user, conversationId, groupId);
	}

	@Post('conversations/:conversationId/message-groups/:groupId/messages')
	addMessagesToGroup(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('groupId') groupId: string,
		@Body() body: WhatsAppMessageGroupMessagesDto,
	) {
		return this.messageGroups.addMessages(req.user, conversationId, groupId, body.messageIds);
	}

	@Post('conversations/:conversationId/message-groups/:groupId/messages/remove')
	removeMessagesFromGroup(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('groupId') groupId: string,
		@Body() body: WhatsAppMessageGroupMessagesDto,
	) {
		return this.messageGroups.removeMessages(
			req.user,
			conversationId,
			groupId,
			body.messageIds,
		);
	}

	@Post('conversations/:conversationId/messages')
	send(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: SendWhatsAppMessageDto,
	) {
		assertSendRateLimit(String(req.user?.id || ''));
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
		if (body.type === 'contact') {
			return this.sync.sendContact(req.user, conversationId, {
				displayName: body.contact?.displayName || body.text || 'Contact',
				phoneNumber: body.contact?.phoneNumber || '',
				waId: body.contact?.waId,
			});
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

	@Put('conversations/:conversationId/messages/:messageId')
	editMessage(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: EditWhatsAppMessageDto,
	) {
		return this.sync.editMessageText(req.user, conversationId, messageId, body.text);
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
			limits: { fileSize: 64 * 1024 * 1024 },
			fileFilter: (_req, file, callback) => {
				const originalName = String(file.originalname || '');
				let mime = String(file.mimetype || '')
					.toLowerCase()
					.replace(/\s+/g, '');
				if (!mime || mime === 'application/octet-stream') {
					const inferred = inferOutgoingMediaMime(originalName);
					if (inferred) {
						mime = inferred;
						file.mimetype = inferred;
					}
				}
				const allowed =
					allowedMediaTypes.has(file.mimetype) ||
					allowedMediaTypes.has(mime) ||
					[...allowedMediaTypes].some(
						type => mime === type.replace(/\s+/g, '') || mime.startsWith(`${type};`),
					);
				if (!allowed) {
					return callback(
						new BadRequestException(
							`Unsupported WhatsApp media type (${mime || file.mimetype || 'unknown'})`,
						),
						false,
					);
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
		assertSendRateLimit(String(req.user?.id || ''));
		await this.access.assertAccountPermission(req.user, accountId, 'canUse');
		if (!file) throw new BadRequestException('File is required');
		let storedPath = file.path;
		let storedName = file.originalname;
		let mimeType = file.mimetype;
		if (looksLikeOutgoingVoiceUpload(file.originalname, file.mimetype)) {
			try {
				const converted = await ensureWhatsAppVoiceOgg(file.path, {
					mimeType: file.mimetype,
					fileName: file.originalname,
				});
				const committed = await commitConvertedVoiceOgg(converted.filePath, file.path);
				await converted.cleanup?.();
				storedPath = committed.sendPath;
				storedName = committed.fileName;
				mimeType = converted.mimeType;
			} catch (error) {
				await fs.promises.rm(file.path, { force: true }).catch(() => undefined);
				const detail = error instanceof Error ? error.message : String(error);
				throw new BadRequestException(
					`Could not prepare voice upload for WhatsApp (${detail}). Ensure FFmpeg is installed on the server.`,
				);
			}
		}
		const stat = await fs.promises.stat(storedPath);
		return {
			fileId: path.relative(mediaRoot(), storedPath).replace(/\\/g, '/'),
			fileName: storedName,
			mimeType,
			size: stat.size,
		};
	}

	@Delete('accounts/:accountId/media')
	async deletePendingUpload(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: DeleteWhatsAppPendingUploadDto,
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canUse');
		const fileId = String(body.fileId || '').trim().replace(/\\/g, '/');
		if (!fileId) throw new BadRequestException('Media fileId is required');
		if (fileId.includes('..') || path.isAbsolute(fileId) || fileId.startsWith('/')) {
			throw new BadRequestException('Invalid media fileId');
		}
		const userRoot = path.resolve(
			mediaRoot(),
			'outgoing',
			String(accountId),
			String(req.user?.id || 'invalid'),
		);
		const filePath = path.resolve(mediaRoot(), fileId);
		// Must be a file *inside* the user outgoing folder — never the folder itself.
		if (!filePath.startsWith(`${userRoot}${path.sep}`)) {
			throw new BadRequestException('Invalid media fileId');
		}
		await fs.promises.rm(filePath, { force: true });
		return { deleted: true };
	}

	@Post('attachments/:attachmentId/download')
	downloadAttachment(@Req() req: any, @Param('attachmentId') attachmentId: string) {
		return this.sync.downloadAttachment(req.user, attachmentId);
	}

	@Get('attachments/:attachmentId/signed-url')
	async signedAttachmentUrl(@Req() req: any, @Param('attachmentId') attachmentId: string) {
		await this.sync.downloadAttachment(req.user, attachmentId);
		const signed = signMediaToken(attachmentId, String(req.user?.id || ''));
		return {
			url: signedMediaPath(attachmentId, signed.token),
			expiresAt: signed.expiresAt,
		};
	}
}
