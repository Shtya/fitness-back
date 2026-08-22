import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateBoardCardDto,
	CreateBoardCardFromMessagesDto,
	CreateBoardColumnDto,
	MoveBoardCardDto,
	ReorderBoardCardsDto,
	ReorderBoardColumnsDto,
	UpdateBoardCardDto,
	UpdateBoardColumnDto,
} from '../dto/whatsapp-board.dto';
import { WhatsAppBoardsService } from '../services/whatsapp-boards.service';

@Controller('whatsapp/accounts/:accountId/board')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppBoardsController {
	constructor(private readonly boards: WhatsAppBoardsService) {}

	@Get()
	getBoard(@Req() req: any, @Param('accountId') accountId: string) {
		return this.boards.getDefaultBoard(req.user, accountId);
	}

	@Post('columns')
	createColumn(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: CreateBoardColumnDto,
	) {
		return this.boards.createColumn(req.user, accountId, body);
	}

	@Patch('columns/:columnId')
	updateColumn(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('columnId') columnId: string,
		@Body() body: UpdateBoardColumnDto,
	) {
		return this.boards.updateColumn(req.user, accountId, columnId, body);
	}

	@Delete('columns/:columnId')
	deleteColumn(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('columnId') columnId: string,
	) {
		return this.boards.deleteColumn(req.user, accountId, columnId);
	}

	@Post('columns/reorder')
	reorderColumns(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: ReorderBoardColumnsDto,
	) {
		return this.boards.reorderColumns(req.user, accountId, body);
	}

	@Post('cards')
	createCard(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: CreateBoardCardDto,
	) {
		return this.boards.createCard(req.user, accountId, body);
	}

	@Post('cards/from-messages')
	createCardFromMessages(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: CreateBoardCardFromMessagesDto,
	) {
		return this.boards.createCardFromMessages(req.user, accountId, body);
	}

	@Patch('cards/:cardId')
	updateCard(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('cardId') cardId: string,
		@Body() body: UpdateBoardCardDto,
	) {
		return this.boards.updateCard(req.user, accountId, cardId, body);
	}

	@Post('cards/:cardId/move')
	moveCard(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('cardId') cardId: string,
		@Body() body: MoveBoardCardDto,
	) {
		return this.boards.moveCard(req.user, accountId, cardId, body);
	}

	@Post('cards/reorder')
	reorderCards(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: ReorderBoardCardsDto,
	) {
		return this.boards.reorderCards(req.user, accountId, body);
	}

	@Delete('cards/:cardId')
	deleteCard(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('cardId') cardId: string,
	) {
		return this.boards.deleteCard(req.user, accountId, cardId);
	}
}
