// src/modules/calendar/calendar.controller.ts
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,            // ✅ add this
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import {
	CreateCalendarItemDto,
	CreateCalendarTypeDto,
	PauseCommitmentDto,
	StartCommitmentDto,
	ToggleCompletionDto,
	UpdateCalendarItemDto,
	UpdateCalendarSettingsDto,
	UpdateCalendarTypeDto,
} from 'dto/calendar.dto';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';

// ✅ Add DTOs for missing endpoints (you can move them to dto/calendar.dto if you want)
class UpdateSoundDto {
	soundEnabled: boolean;
}

// Frontend PATCH /calendar/completions expects this payload shape:
class PatchCompletionDto {
	key?: string;
	completed: boolean;
	itemId?: string;
	date?: string;
}

@Controller('calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalendarController {
	constructor(private readonly service: CalendarService) { }

	// ✅ MISSING: state (frontend calls GET /calendar/state)
	@Get('state')
	getState(@Req() req: any) {
		return this.service.getState(req.user);
	}

	// ✅ MISSING: sound endpoints (frontend calls GET/PUT /calendar/sound)
	@Get('sound')
	getSound(@Req() req: any) {
		return this.service.getSound(req.user);
	}

	@Put('sound')
	updateSound(@Req() req: any, @Body() dto: UpdateSoundDto) {
		return this.service.updateSound(req.user, dto);
	}

	// ---------- Types ----------
	@Get('types')
	listTypes(@Req() req: any) {
		return this.service.listTypes(req.user);
	}

	@Post('types')
	createType(@Req() req: any, @Body() dto: any) {
		return this.service.createType(req.user, dto);
	}

	@Patch('types/:id')
	updateType(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCalendarTypeDto) {
		return this.service.updateType(req.user, id, dto);
	}

	@Delete('types/:id')
	deleteType(@Req() req: any, @Param('id') id: string) {
		return this.service.deleteType(req.user, id);
	}

	// ---------- Items ----------
	@Get('items')
	listItems(@Req() req: any) {
		return this.service.listItems(req.user);
	}

	@Post('items')
	createItem(@Req() req: any, @Body() dto: any) {
		return this.service.createItem(req.user, dto);
	}

	@Patch('items/:id')
	updateItem(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		return this.service.updateItem(req.user, id, dto);
	}

	// ✅ MISSING: frontend uses PUT /calendar/items/:id
	@Put('items/:id')
	updateItemPut(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		return this.service.updateItem(req.user, id, dto);
	}

	@Delete('items/:id')
	deleteItem(@Req() req: any, @Param('id') id: string) {
		return this.service.deleteItem(req.user, id);
	}

	// ---------- Completions ----------
	@Get('completions')
	listCompletions(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
		return this.service.listCompletions(req.user, from, to);
	}

	@Post('completions/toggle')
	toggleCompletion(@Req() req: any, @Body() dto: ToggleCompletionDto) {
		return this.service.toggleCompletion(req.user, dto);
	}

	// ✅ MISSING: frontend uses PATCH /calendar/completions
	@Patch('completions')
	patchCompletion(@Req() req: any, @Body() dto: any) {
		return this.service.patchCompletion(req.user, dto);
	}

	// ---------- Settings ----------
	@Get('settings')
	getSettings(@Req() req: any) {
		return this.service.getSettings(req.user);
	}

	@Patch('settings')
	updateSettings(@Req() req: any, @Body() dto: UpdateCalendarSettingsDto) {
		return this.service.updateSettings(req.user, dto);
	}

	// ✅ MISSING: frontend uses PUT /calendar/settings
	// Frontend sends { settings: {...} } — we support both {settings:{}} and direct dto
	@Put('settings')
	updateSettingsPut(@Req() req: any, @Body() body: any) {
		const dto: UpdateCalendarSettingsDto = body?.settings ?? body;
		return this.service.updateSettings(req.user, dto);
	}

	// ---------- Commitment Timer ----------
	@Get('commitment')
	getCommitment(@Req() req: any) {
		return this.service.getCommitment(req.user);
	}

	@Post('commitment/start')
	startCommitment(@Req() req: any, @Body() dto: StartCommitmentDto) {
		return this.service.startCommitment(req.user, dto);
	}

	@Post('commitment/pause')
	pauseCommitment(@Req() req: any, @Body() dto: PauseCommitmentDto) {
		return this.service.pauseCommitment(req.user, dto);
	}

	@Post('commitment/reset')
	resetCommitment(@Req() req: any) {
		return this.service.resetCommitment(req.user);
	}
}
