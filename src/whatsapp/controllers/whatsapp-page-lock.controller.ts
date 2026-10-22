import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import {
	ChangePageLockDto,
	RemovePageLockDto,
	ResetPageLockWithAccountPasswordDto,
	ResetPageLockWithCodeDto,
	SetupPageLockDto,
	UpdatePageLockSettingsDto,
	VerifyPageLockDto,
} from '../dto/whatsapp-page-lock.dto';
import { WhatsAppPageLockService } from '../services/whatsapp-page-lock.service';

@Controller('whatsapp/page-lock')
@UseGuards(JwtAuthGuard)
export class WhatsAppPageLockController {
	constructor(private readonly pageLock: WhatsAppPageLockService) {}

	@Get()
	status(@Req() req: any) {
		return this.pageLock.status(req.user.id);
	}

	@Post('setup')
	setup(@Req() req: any, @Body() body: SetupPageLockDto) {
		return this.pageLock.setup(req.user.id, body);
	}

	@Post('verify')
	@HttpCode(200)
	verify(@Req() req: any, @Body() body: VerifyPageLockDto) {
		return this.pageLock.verify(req.user.id, body.passcode);
	}

	@Patch('settings')
	updateSettings(@Req() req: any, @Body() body: UpdatePageLockSettingsDto) {
		return this.pageLock.updateSettings(req.user.id, body);
	}

	@Post('change')
	@HttpCode(200)
	change(@Req() req: any, @Body() body: ChangePageLockDto) {
		return this.pageLock.change(req.user.id, body);
	}

	@Post('remove')
	@HttpCode(200)
	remove(@Req() req: any, @Body() body: RemovePageLockDto) {
		return this.pageLock.remove(req.user.id, body);
	}

	@Post('forgot')
	@HttpCode(200)
	forgot(@Req() req: any) {
		return this.pageLock.sendResetCode(req.user.id);
	}

	@Post('forgot/code')
	@HttpCode(200)
	resetWithCode(@Req() req: any, @Body() body: ResetPageLockWithCodeDto) {
		return this.pageLock.resetWithCode(req.user.id, body);
	}

	@Post('forgot/account-password')
	@HttpCode(200)
	resetWithAccountPassword(@Req() req: any, @Body() body: ResetPageLockWithAccountPasswordDto) {
		return this.pageLock.resetWithAccountPassword(req.user.id, body);
	}
}
