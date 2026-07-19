import {
	Controller,
	Get,
	Param,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppAuditService } from '../services/whatsapp-audit.service';
import { WhatsAppReportsService } from '../services/whatsapp-reports.service';

@Controller('whatsapp/accounts/:accountId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppReportsController {
	constructor(
		private readonly reports: WhatsAppReportsService,
		private readonly audit: WhatsAppAuditService,
		private readonly access: WhatsAppAccessService,
	) {}

	@Get('reports/summary')
	summary(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('from') from?: string,
		@Query('to') to?: string,
	) {
		return this.reports.summary(req.user, accountId, from, to);
	}

	@Get('audit-logs')
	async auditLogs(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('page') page = '1',
		@Query('limit') limit = '50',
	) {
		await this.access.assertAccountPermission(req.user, accountId, 'canManage');
		return this.audit.list(accountId, Number(page), Number(limit));
	}
}
