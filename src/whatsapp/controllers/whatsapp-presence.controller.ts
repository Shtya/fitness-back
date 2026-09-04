import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppContactPresenceService } from '../services/whatsapp-contact-presence.service';

@Controller('whatsapp/presence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppPresenceController {
	constructor(
		private readonly contactPresence: WhatsAppContactPresenceService,
		private readonly access: WhatsAppAccessService,
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
		return await this.contactPresence.listOnline(id, {
			includeOffline: wantOffline,
		});
	}
}
