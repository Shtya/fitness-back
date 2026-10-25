import {
	BadRequestException,
	Body,
	Controller,
	ForbiddenException,
	Get,
	Put,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppContactPresenceService } from '../services/whatsapp-contact-presence.service';
import { WhatsAppPresenceWatchService } from '../services/whatsapp-presence-watch.service';

@Controller('whatsapp/presence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppPresenceController {
	constructor(
		private readonly contactPresence: WhatsAppContactPresenceService,
		private readonly access: WhatsAppAccessService,
		private readonly watch: WhatsAppPresenceWatchService,
	) {}

	/**
	 * WhatsApp contacts currently online (customer presence), scoped to one linked account.
	 * Source of truth is Baileys/WPP presence events — never CRM activity.
	 */
	@Get('online')
	async listOnline(
		@Req() req: any,
		@Query('accountId') accountId?: string,
		@Query('includeOffline') includeOffline?: string,
	) {
		const id = String(accountId || '').trim();
		if (!id) {
			return { accountId: null, items: [], at: new Date().toISOString() };
		}
		const access = await this.access.getAccountAccess(req.user, id);
		if (!access.canView) {
			throw new ForbiddenException('WhatsApp account access denied');
		}
		// Event-driven subscribe (throttled). Do not poll every contact.
		void this.contactPresence.subscribeRecentDirectChats(id).catch(() => undefined);
		const wantOffline =
			includeOffline === '1' ||
			includeOffline === 'true' ||
			includeOffline === 'yes';
		const snapshot = await this.contactPresence.listOnline(id, {
			includeOffline: wantOffline,
		});
		if (this.access.canSeeAllConversations(req.user, access)) return snapshot;
		return this.contactPresence.restrictToAssignee(snapshot, String(req.user?.id || ''));
	}

	/** Conversation ids the current user follows on this account ("notify me when online"). */
	@Get('watch')
	async listWatch(@Req() req: any, @Query('accountId') accountId?: string) {
		const id = String(accountId || '').trim();
		if (!id) return { accountId: null, conversationIds: [] };
		const access = await this.access.getAccountAccess(req.user, id);
		if (!access.canView) throw new ForbiddenException('WhatsApp account access denied');
		return { accountId: id, conversationIds: await this.watch.list(id, String(req.user.id)) };
	}

	/** Follow / unfollow one contact. Only chats the user can already see may be followed. */
	@Put('watch')
	async setWatch(
		@Req() req: any,
		@Body() body: { accountId?: string; conversationId?: string; watch?: boolean },
	) {
		const accountId = String(body?.accountId || '').trim();
		const conversationId = String(body?.conversationId || '').trim();
		if (!accountId || !conversationId) {
			throw new BadRequestException('accountId and conversationId are required');
		}
		const { conversation } = await this.access.assertConversationVisible(req.user, conversationId);
		if (String(conversation.accountId) !== accountId) {
			throw new BadRequestException('Conversation does not belong to this account');
		}
		if (body?.watch !== false && String(conversation.providerChatId || '').endsWith('@g.us')) {
			throw new BadRequestException('Online status is only available for one-to-one chats');
		}
		const conversationIds = await this.watch.setWatch(
			accountId,
			String(req.user.id),
			conversationId,
			body?.watch !== false,
		);
		return { accountId, conversationIds };
	}
}
