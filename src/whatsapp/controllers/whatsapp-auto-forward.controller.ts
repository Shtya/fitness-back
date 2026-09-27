import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppAutoForwardRuleDto,
	UpdateWhatsAppAutoForwardRuleDto,
} from '../dto/whatsapp-auto-forward.dto';
import { WhatsAppAutoForwardService } from '../services/whatsapp-auto-forward.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppAutoForwardController {
	constructor(private readonly autoForward: WhatsAppAutoForwardService) {}

	@Get('accounts/:accountId/auto-forward-rules')
	list(@Req() req: any, @Param('accountId') accountId: string) {
		return this.autoForward.listForAccount(req.user, accountId);
	}

	@Post('accounts/:accountId/auto-forward-rules')
	create(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: CreateWhatsAppAutoForwardRuleDto,
	) {
		return this.autoForward.create(req.user, accountId, body);
	}

	@Patch('auto-forward-rules/:ruleId')
	update(
		@Req() req: any,
		@Param('ruleId') ruleId: string,
		@Body() body: UpdateWhatsAppAutoForwardRuleDto,
	) {
		return this.autoForward.update(req.user, ruleId, body);
	}

	@Delete('auto-forward-rules/:ruleId')
	remove(@Req() req: any, @Param('ruleId') ruleId: string) {
		return this.autoForward.remove(req.user, ruleId);
	}
}
