import {
	Body,
	Controller,
	Get,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { UpdateEmailMemoSettingsDto, SaveGmailCredentialsDto, EmailMemoSenderDto } from './dto/email-memo.dto';
import { EmailMemoGmailService } from './services/email-memo-gmail.service';
import { EmailMemoService } from './services/email-memo.service';
import { EmailMemoWhatsAppService } from './services/email-memo-whatsapp.service';
import { EmailMemoSettingsService } from './services/email-memo-settings.service';

const ROLES = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT] as const;

@Controller('email-memo')
export class EmailMemoController {
	constructor(
		private readonly service: EmailMemoService,
		private readonly gmail: EmailMemoGmailService,
		private readonly whatsapp: EmailMemoWhatsAppService,
		private readonly settings: EmailMemoSettingsService,
	) {}

	@Get('overview')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	overview(@Req() req: any) {
		return this.service.overview(req.user.id);
	}

	@Get('gmail/auth-url')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	async gmailAuthUrl(
		@Req() req: any,
		@Query('locale') locale?: string,
		@Query('connectionId') connectionId?: string,
		@Query('returnOrigin') returnOrigin?: string,
	) {
		return {
			url: await this.service.gmailAuthUrl(
				req.user.id,
				locale,
				connectionId,
				returnOrigin || req.headers?.origin,
			),
		};
	}

	@Put('gmail/credentials')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	saveGmailCredentials(@Req() req: any, @Body() dto: SaveGmailCredentialsDto) {
		return this.gmail.saveOAuthApp(req.user.id, dto.clientId || '', dto.clientSecret);
	}

	@Post('gmail/credentials')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	saveGmailCredentialsPost(@Req() req: any, @Body() dto: SaveGmailCredentialsDto) {
		return this.gmail.saveOAuthApp(req.user.id, dto.clientId || '', dto.clientSecret);
	}

	@Post('gmail/credentials/test')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	testGmailCredentials(@Req() req: any, @Body() dto: SaveGmailCredentialsDto) {
		return this.gmail.testOAuthApp(req.user.id, dto.clientId, dto.clientSecret);
	}

	@Get('gmail/callback')
	async gmailCallback(
		@Query('code') code: string,
		@Query('state') state: string,
		@Query('error') error: string,
		@Res() res: Response,
	) {
		if (error || !code) {
			return res.redirect(this.gmail.frontendRedirect('en', 'error', error || 'Missing code'));
		}
		try {
			const result = await this.gmail.handleCallback(code, state);
			return res.redirect(
				this.gmail.frontendRedirect(result.locale, 'connected', undefined, result.returnOrigin),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Gmail connect failed';
			return res.redirect(this.gmail.frontendRedirect('en', 'error', message));
		}
	}

	@Post('gmail/disconnect')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	disconnectGmail(@Req() req: any, @Body() body?: { connectionId?: string }) {
		return this.gmail.disconnect(req.user.id, body?.connectionId);
	}

	@Post('gmail/accounts/:id/disconnect')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	disconnectGmailAccount(@Req() req: any, @Param('id') id: string) {
		return this.gmail.disconnect(req.user.id, id);
	}

	@Post('gmail/sync')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	syncGmail(@Req() req: any) {
		return this.service.syncGmail(req.user.id);
	}

	@Post('gmail/accounts/:id/sync')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	syncGmailAccount(@Req() req: any, @Param('id') id: string) {
		return this.service.syncGmail(req.user.id, id);
	}

	@Get('senders')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listSenders(@Req() req: any) {
		return this.service.listSenders(req.user.id);
	}

	@Post('senders/exclude')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	excludeSender(@Req() req: any, @Body() dto: EmailMemoSenderDto) {
		return this.service.excludeSender(req.user.id, dto.email);
	}

	@Post('senders/include')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	includeSender(@Req() req: any, @Body() dto: EmailMemoSenderDto) {
		return this.service.includeSender(req.user.id, dto.email);
	}

	@Post('whatsapp/connect')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	connectWhatsApp(@Req() req: any) {
		return this.whatsapp.connect(req.user.id);
	}

	@Get('whatsapp/qr')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	whatsappQr(@Req() req: any) {
		return this.whatsapp.whatsappQr(req.user.id);
	}

	@Get('whatsapp/chats')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	async whatsappChats(@Req() req: any) {
		return { items: await this.whatsapp.listChats(req.user.id) };
	}

	@Post('whatsapp/disconnect')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	disconnectWhatsApp(@Req() req: any) {
		return this.whatsapp.disconnect(req.user.id, true);
	}

	@Post('whatsapp/test')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	async testWhatsApp(@Req() req: any) {
		const settings = await this.settings.getOrCreate(req.user.id);
		const chatId = await this.whatsapp.resolveTargetChat(req.user.id, settings.targetChatId);
		const sent = await this.whatsapp.sendText(
			req.user.id,
			chatId,
			'📧 Email Memo\n\nWhatsApp is connected and ready to receive email memos.',
		);
		return { ok: true, ...sent };
	}

	@Get('messages')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	messages(@Req() req: any, @Query('limit') limit?: string) {
		return this.service.listMessages(req.user.id, Number(limit) || 40);
	}

	@Get('messages/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	messageDetail(@Req() req: any, @Param('id') id: string) {
		return this.service.messageDetail(req.user.id, id);
	}

	@Post('messages/:id/retry')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	retry(@Req() req: any, @Param('id') id: string) {
		return this.service.retryMessage(req.user.id, id);
	}

	@Get('settings')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	async getSettings(@Req() req: any) {
		const row = await this.settings.getOrCreate(req.user.id);
		return this.settings.toPublic(row);
	}

	@Put('settings')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	updateSettings(@Req() req: any, @Body() dto: UpdateEmailMemoSettingsDto) {
		return this.service.updateSettings(req.user.id, dto);
	}

	@Post('settings')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	saveSettings(@Req() req: any, @Body() dto: UpdateEmailMemoSettingsDto) {
		return this.service.updateSettings(req.user.id, dto);
	}
}
