import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Req,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import {
	CreateGoldHoldingDto,
	CreateTrackerItemDto,
	TrackerBalanceDto,
	UpdateGoldHoldingDto,
	UpdateTrackerItemDto,
} from './wallet-tracker.dto';
import { TrackerItemKind } from './wallet-tracker.rules';
import { WalletTrackerService } from './wallet-tracker.service';

function userIdOf(req: any): string {
	const id = req?.user?.id;
	if (!id) throw new UnauthorizedException();
	return String(id);
}

function kindOf(value: string): TrackerItemKind {
	if (value === 'pending' || value === 'received') return value;
	throw new BadRequestException('Unknown item kind');
}

@UseGuards(JwtAuthGuard)
@Controller('money/tracker')
export class WalletTrackerController {
	constructor(private readonly tracker: WalletTrackerService) {}

	@Get()
	get(@Req() req: any) {
		return this.tracker.getTracker(userIdOf(req));
	}

	@Patch('balance')
	updateBalance(@Req() req: any, @Body() dto: TrackerBalanceDto) {
		return this.tracker.updateBalance(userIdOf(req), dto);
	}

	@Post('items')
	createItem(@Req() req: any, @Body() dto: CreateTrackerItemDto) {
		return this.tracker.createItem(userIdOf(req), dto);
	}

	@Patch('items/:kind/:id')
	updateItem(
		@Req() req: any,
		@Param('kind') kind: string,
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: UpdateTrackerItemDto,
	) {
		return this.tracker.updateItem(userIdOf(req), kindOf(kind), id, dto);
	}

	@Post('items/:kind/:id/toggle')
	toggleItem(@Req() req: any, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
		return this.tracker.toggleItem(userIdOf(req), kindOf(kind), id);
	}

	@Post('gold')
	createGold(@Req() req: any, @Body() dto: CreateGoldHoldingDto) {
		return this.tracker.createGold(userIdOf(req), dto);
	}

	@Patch('gold/:id')
	updateGold(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGoldHoldingDto) {
		return this.tracker.updateGold(userIdOf(req), id, dto);
	}

	@Delete('gold/:id')
	deleteGold(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
		return this.tracker.deleteGold(userIdOf(req), id);
	}

	@Delete('items/:kind/:id')
	deleteItem(
		@Req() req: any,
		@Param('kind') kind: string,
		@Param('id', ParseUUIDPipe) id: string,
		@Query('revert') revert?: string,
	) {
		return this.tracker.deleteItem(userIdOf(req), kindOf(kind), id, revert === '1' || revert === 'true');
	}
}
