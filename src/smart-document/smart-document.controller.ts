import { Body, Controller, Get, Param, Put, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { SmartDocumentService } from './smart-document.service';

@Controller('smart-documents')
export class SmartDocumentController {
	constructor(private readonly service: SmartDocumentService) {}

	@UseGuards(JwtAuthGuard)
	@Post('shares')
	upsertShare(@Body() body: any, @Req() req: any) {
		return this.service.upsertShare(String(req.user.id), body || {});
	}

	@Get('public/:token')
	getPublic(@Param('token') token: string) {
		return this.service.getPublic(token);
	}

	@Put('public/:token')
	updatePublic(@Param('token') token: string, @Body() body: any) {
		return this.service.updatePublic(token, body || {});
	}
}
