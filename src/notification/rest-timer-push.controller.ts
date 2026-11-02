import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RestTimerPushService } from './rest-timer-push.service';

@Controller('notifications/rest-timer')
@UseGuards(JwtAuthGuard)
export class RestTimerPushController {
	constructor(private readonly svc: RestTimerPushService) {}

	@Post()
	schedule(@Req() req: any, @Body() body: { endsAt?: string; title?: string; body?: string }) {
		return this.svc.schedule(req.user.id, body);
	}

	@Delete()
	cancel(@Req() req: any) {
		return this.svc.cancel(req.user.id);
	}
}
