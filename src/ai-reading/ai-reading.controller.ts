import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { AiReadingService } from './ai-reading.service';

@Controller('ai-reading')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
export class AiReadingController {
	constructor(private readonly service: AiReadingService) {}

	@Get('state')
	getState(@Req() req: any) {
		return this.service.getState(req.user);
	}

	@Put('state')
	putState(@Req() req: any, @Body() body: any) {
		return this.service.putState(req.user, body);
	}

	@Post('books')
	upsertBook(@Req() req: any, @Body() body: any) {
		return this.service.upsertBook(req.user, body?.book || body);
	}

	@Delete('books/:id')
	deleteBook(@Req() req: any, @Param('id') id: string) {
		return this.service.deleteBook(req.user, id);
	}
}
