import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { WhatsAppTypingAttemptsService } from '../services/whatsapp-typing-attempts.service';

@Controller('whatsapp/typing-attempts')
@UseGuards(JwtAuthGuard)
export class WhatsAppTypingAttemptsController {
	constructor(private readonly typingAttempts: WhatsAppTypingAttemptsService) {}

	/** Scoped like the inbox: account `canView`, and only assigned chats for restricted members. */
	@Get()
	list(
		@Req() req: any,
		@Query()
		query: {
			accountId?: string;
			conversationId?: string;
			filter?: string;
			from?: string;
			to?: string;
			q?: string;
			limit?: string;
			offset?: string;
		},
	) {
		return this.typingAttempts.list(req.user, query);
	}

	/** Chats with typing attempts in the range, same scope as the list. */
	@Get('chats')
	chats(@Req() req: any, @Query() query: { accountId?: string; from?: string; to?: string }) {
		return this.typingAttempts.chats(req.user, query);
	}

	/** Account `canManage`: minutes without a message before an attempt closes as `no_message`. */
	@Put('settings')
	updateSettings(
		@Req() req: any,
		@Body() body: { accountId?: string; noMessageWindowMinutes?: number },
	) {
		return this.typingAttempts.updateSettings(req.user, body);
	}
}
