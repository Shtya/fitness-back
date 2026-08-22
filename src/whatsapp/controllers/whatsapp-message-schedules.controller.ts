import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppMessageScheduleDto,
	UpdateWhatsAppMessageScheduleDto,
} from '../dto/whatsapp-schedule.dto';
import { WhatsAppMessageSchedulesService } from '../services/whatsapp-message-schedules.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppMessageSchedulesController {
	constructor(private readonly schedules: WhatsAppMessageSchedulesService) {}

	@Post('accounts/:accountId/message-schedules')
	create(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: CreateWhatsAppMessageScheduleDto,
	) {
		return this.schedules.create(req.user, accountId, body);
	}

	@Get('accounts/:accountId/message-schedules')
	listForAccount(@Req() req: any, @Param('accountId') accountId: string) {
		return this.schedules.listForAccount(req.user, accountId);
	}

	@Get('conversations/:conversationId/message-schedules')
	listForConversation(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.schedules.listForConversation(req.user, conversationId);
	}

	@Get('message-schedules/:scheduleId')
	getOne(@Req() req: any, @Param('scheduleId') scheduleId: string) {
		return this.schedules.getOne(req.user, scheduleId);
	}

	@Patch('message-schedules/:scheduleId')
	update(
		@Req() req: any,
		@Param('scheduleId') scheduleId: string,
		@Body() body: UpdateWhatsAppMessageScheduleDto,
	) {
		return this.schedules.update(req.user, scheduleId, body);
	}

	@Post('message-schedules/:scheduleId/pause')
	pause(@Req() req: any, @Param('scheduleId') scheduleId: string) {
		return this.schedules.pause(req.user, scheduleId);
	}

	@Post('message-schedules/:scheduleId/resume')
	resume(@Req() req: any, @Param('scheduleId') scheduleId: string) {
		return this.schedules.resume(req.user, scheduleId);
	}

	@Delete('message-schedules/:scheduleId')
	cancel(@Req() req: any, @Param('scheduleId') scheduleId: string) {
		return this.schedules.cancel(req.user, scheduleId);
	}
}
