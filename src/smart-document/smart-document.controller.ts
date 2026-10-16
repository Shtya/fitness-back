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

	@UseGuards(JwtAuthGuard)
	@Get('shares/:token/visits')
	listVisits(@Param('token') token: string, @Req() req: any) {
		return this.service.listVisitsForOwner(String(req.user.id), token);
	}

	@Get('public/:token')
	getPublic(@Param('token') token: string) {
		return this.service.getPublic(token);
	}

	@Put('public/:token')
	updatePublic(@Param('token') token: string, @Body() body: any) {
		return this.service.updatePublic(token, body || {});
	}

	@Post('public/:token/visit')
	recordVisit(@Param('token') token: string, @Body() body: any, @Req() req: any) {
		return this.service.recordVisit(token, req, body || {});
	}
}
