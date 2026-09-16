import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppLibraryFolderDto,
	RenameWhatsAppLibraryFolderDto,
	SaveWhatsAppLibraryAttachmentDto,
	SaveWhatsAppLibraryVoiceEditDto,
	SendWhatsAppLibraryItemDto,
	UpdateWhatsAppLibraryItemDto,
} from '../dto/whatsapp.dto';
import { WhatsAppMediaLibraryService } from '../services/whatsapp-media-library.service';
import { assertSendRateLimit } from '../utils/whatsapp-send-rate-limit';

/** Saved media library — per-user, not scoped to a conversation or an account. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp/library')
export class WhatsAppMediaLibraryController {
	constructor(private readonly library: WhatsAppMediaLibraryService) {}

	@Get('folders')
	listFolders(@Req() req: any) {
		return this.library.listFolders(req.user);
	}

	@Post('folders')
	createFolder(@Req() req: any, @Body() body: CreateWhatsAppLibraryFolderDto) {
		return this.library.createFolder(req.user, body?.name);
	}

	@Put('folders/:folderId')
	renameFolder(
		@Req() req: any,
		@Param('folderId') folderId: string,
		@Body() body: RenameWhatsAppLibraryFolderDto,
	) {
		return this.library.renameFolder(req.user, folderId, body?.name);
	}

	@Delete('folders/:folderId')
	deleteFolder(@Req() req: any, @Param('folderId') folderId: string) {
		return this.library.deleteFolder(req.user, folderId);
	}

	/** `folderId` omitted lists everything; `folderId=root` lists unsorted items. */
	@Get('items')
	listItems(@Req() req: any, @Query('folderId') folderId?: string) {
		if (folderId === undefined) return this.library.listItems(req.user);
		return this.library.listItems(req.user, folderId === 'root' ? null : folderId);
	}

	@Post('items/from-attachment')
	saveAttachment(@Req() req: any, @Body() body: SaveWhatsAppLibraryAttachmentDto) {
		return this.library.saveAttachment(req.user, body.attachmentId, {
			folderId: body.folderId ?? null,
			title: body.title,
		});
	}

	/** Renders the voice edit and keeps it, without sending anything. */
	@Post('items/from-voice-edit')
	saveVoiceEdit(@Req() req: any, @Body() body: SaveWhatsAppLibraryVoiceEditDto) {
		const { attachmentId, folderId, title, ...editOptions } = body;
		return this.library.saveVoiceEdit(req.user, attachmentId, editOptions, {
			folderId: folderId ?? null,
			title,
		});
	}

	@Patch('items/:itemId')
	updateItem(
		@Req() req: any,
		@Param('itemId') itemId: string,
		@Body() body: UpdateWhatsAppLibraryItemDto,
	) {
		return this.library.updateItem(req.user, itemId, {
			// `folderId: null` moves an item back to the root, so only skip the key when
			// the client did not send it at all.
			...(body.title === undefined ? {} : { title: body.title }),
			...(body.folderId === undefined ? {} : { folderId: body.folderId }),
		});
	}

	@Delete('items/:itemId')
	deleteItem(@Req() req: any, @Param('itemId') itemId: string) {
		return this.library.deleteItem(req.user, itemId);
	}

	/** Inline playback/preview for the library UI. */
	@Get('items/:itemId/content')
	async itemContent(@Req() req: any, @Res() res: Response, @Param('itemId') itemId: string) {
		const { item, absolutePath } = await this.library.resolveItemFile(req.user, itemId);
		const stat = await fs.stat(absolutePath);
		res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
		res.setHeader('Content-Length', String(stat.size));
		res.setHeader('Accept-Ranges', 'bytes');
		// Private: the response is per-user and the URL carries no signature.
		res.setHeader('Cache-Control', 'private, max-age=600');
		createReadStream(absolutePath).pipe(res);
	}

	@Post('items/:itemId/send')
	sendItem(
		@Req() req: any,
		@Param('itemId') itemId: string,
		@Body() body: SendWhatsAppLibraryItemDto,
	) {
		assertSendRateLimit(String(req.user?.id || ''));
		return this.library.sendItem(req.user, itemId, body.conversationId, {
			clientMessageId: body.clientMessageId,
		});
	}
}
