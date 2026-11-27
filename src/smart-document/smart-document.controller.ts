import { Body, Controller, Delete, Get, Param, Put, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { SmartDocumentService } from './smart-document.service';
import { SmartDocumentStoreService } from './smart-document-store.service';

@Controller('smart-documents')
export class SmartDocumentController {
	constructor(
		private readonly service: SmartDocumentService,
		private readonly store: SmartDocumentStoreService,
	) {}

	/* ── the signed-in user's own documents (the editor's history, kept in the database) ── */

	@UseGuards(JwtAuthGuard)
	@Get('docs')
	listDocs(@Req() req: any) {
		return this.store.list(String(req.user.id));
	}

	/** On open: send the browser's copies, get back the merged list (newer copy wins). */
	@UseGuards(JwtAuthGuard)
	@Post('docs/sync')
	syncDocs(@Body() body: any, @Req() req: any) {
		return this.store.sync(String(req.user.id), body?.docs);
	}

	@UseGuards(JwtAuthGuard)
	@Put('docs/:clientId')
	saveDoc(@Param('clientId') clientId: string, @Body() body: any, @Req() req: any) {
		return this.store.upsert(String(req.user.id), { ...(body || {}), id: clientId });
	}

	@UseGuards(JwtAuthGuard)
	@Delete('docs/:clientId')
	deleteDoc(@Param('clientId') clientId: string, @Req() req: any) {
		return this.store.remove(String(req.user.id), clientId);
	}

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
