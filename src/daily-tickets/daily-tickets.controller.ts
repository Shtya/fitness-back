import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { CreateDailyTicketDto, ImportDailyTicketsDto, ListDailyTicketsQuery, ReorderDailyTicketsDto, UpdateDailyTicketDto } from './daily-tickets.dto';
import { DailyTicketsService } from './daily-tickets.service';

/** Personal daily tickets: every route only ever sees the signed-in user's own tickets. */
@Controller('daily-tickets')
@UseGuards(JwtAuthGuard)
export class DailyTicketsController {
	constructor(private readonly service: DailyTicketsService) {}

	private userId(req: any): string {
		const id = req.user?.id;
		if (!id) throw new UnauthorizedException();
		return String(id);
	}

	@Get()
	list(@Req() req: any, @Query() query: ListDailyTicketsQuery) {
		return this.service.list(this.userId(req), query.today);
	}

	@Post()
	create(@Req() req: any, @Body() body: CreateDailyTicketDto) {
		return this.service.create(this.userId(req), body);
	}

	@Post('import')
	import(@Req() req: any, @Body() body: ImportDailyTicketsDto) {
		return this.service.import(this.userId(req), body.items);
	}

	@Put('order')
	reorder(@Req() req: any, @Body() body: ReorderDailyTicketsDto) {
		return this.service.reorder(this.userId(req), body.ids);
	}

	@Patch(':id')
	update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDailyTicketDto) {
		return this.service.update(this.userId(req), id, body);
	}

	@Delete(':id')
	remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.remove(this.userId(req), id);
	}
}
