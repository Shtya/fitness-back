import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
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
}
