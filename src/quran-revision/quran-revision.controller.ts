import { Body, Controller, Get, Put, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { QuranRevisionService } from './quran-revision.service';

@Controller('quran-revision')
@UseGuards(JwtAuthGuard)
export class QuranRevisionController {
	constructor(private readonly service: QuranRevisionService) {}

	@Get('state')
	getState(@Req() req: any) {
		return this.service.getState(req.user);
	}

	@Put('state')
	putState(@Req() req: any, @Body() body: any) {
		return this.service.putState(req.user, body);
	}

	@Post('import')
	importState(@Req() req: any, @Body() body: any) {
		return this.service.importState(req.user, body);
	}
}
