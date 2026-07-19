import {
	BadRequestException,
	Controller,
	Get,
	Param,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppConnectionLog } from '../entities/whatsapp.entity';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppAuditService } from '../services/whatsapp-audit.service';
import { WhatsAppProviderManagerService } from '../services/whatsapp-provider-manager.service';

@Controller('whatsapp/accounts/:accountId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppConnectionController {
	constructor(
		private readonly access: WhatsAppAccessService,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly audit: WhatsAppAuditService,
		@InjectRepository(WhatsAppConnectionLog)
		private readonly logs: Repository<WhatsAppConnectionLog>,
	) {}

	@Post('connect')
	async connect(@Req() req: any, @Param('accountId') accountId: string) {
		await this.access.assertAccountPermission(req.user, accountId, 'canManage');
		try {
			const provider = await this.providers.connect(accountId);
			await this.audit.write({
				actorUserId: req.user.id,
				accountId,
				action: 'whatsapp.account.connect_requested',
				targetType: 'WhatsAppAccount',
				targetId: accountId,
			});
			return { ok: true, status: provider.getState(), qr: provider.getQr() };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new BadRequestException(message);
		}
	}

	@Get('qr')
	async qr(@Req() req: any, @Param('accountId') accountId: string) {
		const account = await this.access.assertAccountPermission(
			req.user,
			accountId,
			'canManage',
		);
		return {
			qr: this.providers.getQr(accountId),
			status: account.status,
		};
	}

	@Post('disconnect')
	async disconnect(@Req() req: any, @Param('accountId') accountId: string) {
		await this.access.assertAccountPermission(req.user, accountId, 'canManage');
		const result = await this.providers.disconnect(accountId, false);
		await this.audit.write({
			actorUserId: req.user.id,
			accountId,
			action: 'whatsapp.account.disconnected',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
		});
		return result;
	}

	@Post('logout')
	async logout(@Req() req: any, @Param('accountId') accountId: string) {
		await this.access.assertAccountPermission(req.user, accountId, 'canManage');
		const result = await this.providers.disconnect(accountId, true);
		await this.audit.write({
			actorUserId: req.user.id,
			accountId,
			action: 'whatsapp.account.logged_out',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
		});
		return result;
	}

	@Get('logs')
	async connectionLogs(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('limit') limit = '50',
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canView');
		return this.logs.find({
			where: { accountId },
			order: { created_at: 'DESC' },
			take: Math.min(Math.max(Number(limit) || 50, 1), 200),
		});
	}
}
