import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpException,
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
import { ConnectWhatsAppAccountDto } from '../dto/whatsapp.dto';
import { WhatsAppConnectionLog } from '../entities/whatsapp.entity';
import { resolveWhatsAppSyncPhase } from '../services/whatsapp-accounts.service';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppAuditService } from '../services/whatsapp-audit.service';
import { WhatsAppProviderManagerService } from '../services/whatsapp-provider-manager.service';
import { assertPairingCodeRateLimit } from '../utils/whatsapp-pairing-rate-limit';

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
	async connect(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: ConnectWhatsAppAccountDto,
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canManage');
		try {
			if (body?.phoneNumber) {
				assertPairingCodeRateLimit(`${req.user.id}:${accountId}`);
			}
			const provider = await this.providers.connect(accountId, body?.phoneNumber, {
				connectionMethod: body?.phoneNumber
					? 'pairing_code'
					: body?.mode === 'qr'
						? 'qr'
						: undefined,
			});
			await this.audit.write({
				actorUserId: req.user.id,
				accountId,
				action: 'whatsapp.account.connect_requested',
				targetType: 'WhatsAppAccount',
				targetId: accountId,
				metadata: body?.phoneNumber
					? { mode: 'pairing_code' }
					: { mode: body?.mode || 'restore' },
			});
			const account = await this.access.assertAccountPermission(
				req.user,
				accountId,
				'canManage',
			);
			const storedMethod = account.providerCapabilities?.connectionMethod;
			return {
				ok: true,
				status: provider.getState(),
				qr: provider.getQr(),
				pairingCode: provider.getPairingCode(),
				connectionMethod:
					storedMethod === 'pairing_code' || storedMethod === 'qr'
						? storedMethod
						: body?.phoneNumber
							? 'pairing_code'
							: body?.mode || null,
				restore: {
					hasLocalHistory: Boolean(account.initialHydratedAt),
					syncPhase: resolveWhatsAppSyncPhase(account),
				},
			};
		} catch (error) {
			if (error instanceof HttpException) throw error;
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
			pairingCode: this.providers.getPairingCode(accountId),
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
