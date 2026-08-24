import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppBoard,
	WhatsAppBoardCard,
	WhatsAppBoardCardLink,
	WhatsAppBoardColumn,
	WhatsAppMessage,
} from '../entities/whatsapp.entity';
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
import { WhatsAppAccessService } from './whatsapp-access.service';

const DEFAULT_COLUMNS = [
	{ name: 'To Do', color: '#667eea' },
	{ name: 'In Progress', color: '#f5576c' },
	{ name: 'Review', color: '#4facfe' },
	{ name: 'Done', color: '#43e97b' },
];

@Injectable()
export class WhatsAppBoardsService {
	constructor(
		@InjectRepository(WhatsAppBoard)
		private readonly boardRepo: Repository<WhatsAppBoard>,
		@InjectRepository(WhatsAppBoardColumn)
		private readonly columnRepo: Repository<WhatsAppBoardColumn>,
		@InjectRepository(WhatsAppBoardCard)
		private readonly cardRepo: Repository<WhatsAppBoardCard>,
		@InjectRepository(WhatsAppBoardCardLink)
		private readonly linkRepo: Repository<WhatsAppBoardCardLink>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly access: WhatsAppAccessService,
	) {}

	async getDefaultBoard(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		let board = await this.boardRepo.findOne({
			where: { accountId, isDefault: true },
		});
		if (!board) {
			board = await this.boardRepo.save(
				this.boardRepo.create({
					accountId,
					name: 'Tasks',
					isDefault: true,
					createdByUserId: user.id,
				}),
			);
			await this.columnRepo.save(
				DEFAULT_COLUMNS.map((item, index) =>
					this.columnRepo.create({
						boardId: board!.id,
						name: item.name,
						color: item.color,
						orderIndex: index,
					}),
				),
			);
		}
		return this.loadBoardPayload(board.id, user, accountId);
	}

	async createColumn(user: User, accountId: string, body: CreateBoardColumnDto) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const maxOrder = await this.columnRepo
			.createQueryBuilder('column')
			.select('MAX(column.orderIndex)', 'max')
			.where('column.boardId = :boardId', { boardId: board.id })
			.getRawOne<{ max: string | null }>();
		const column = await this.columnRepo.save(
			this.columnRepo.create({
				boardId: board.id,
				name: body.name.trim(),
				color: body.color || null,
				orderIndex: (Number(maxOrder?.max) || 0) + 1,
			}),
		);
		return this.toColumnDto(column, []);
	}

	async updateColumn(
		user: User,
		accountId: string,
		columnId: string,
		body: UpdateBoardColumnDto,
	) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const column = await this.requireColumn(board.id, columnId);
		if (body.name != null) column.name = body.name.trim();
		if (body.color !== undefined) column.color = body.color || null;
		if (body.orderIndex != null) column.orderIndex = body.orderIndex;
		await this.columnRepo.save(column);
		const cards = await this.cardsForColumn(column.id);
		return this.toColumnDto(column, cards);
	}

	async deleteColumn(user: User, accountId: string, columnId: string) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const columns = await this.columnRepo.find({
			where: { boardId: board.id },
			order: { orderIndex: 'ASC' },
		});
		if (columns.length <= 1) {
			throw new BadRequestException('Board must keep at least one column');
		}
		const column = await this.requireColumn(board.id, columnId);
		const fallback = columns.find((item) => item.id !== column.id);
		if (fallback) {
			await this.cardRepo.update({ columnId: column.id }, { columnId: fallback.id });
		}
		await this.cardRepo.softDelete({ columnId: column.id });
		await this.columnRepo.softRemove(column);
		return { deleted: true, columnId };
	}

	async reorderColumns(user: User, accountId: string, body: ReorderBoardColumnsDto) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const columns = await this.columnRepo.find({ where: { boardId: board.id } });
		const byId = new Map(columns.map((item) => [item.id, item]));
		for (let index = 0; index < body.columnIds.length; index += 1) {
			const column = byId.get(body.columnIds[index]);
			if (!column) continue;
			column.orderIndex = index;
			await this.columnRepo.save(column);
		}
		return this.loadBoardPayload(board.id, user, accountId);
	}

	async createCard(user: User, accountId: string, body: CreateBoardCardDto) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const column = await this.requireColumn(board.id, body.columnId);
		if (body.conversationId) {
			await this.access.assertConversationVisible(user, body.conversationId);
		}
		const orderIndex = await this.nextCardOrder(column.id);
		const card = await this.cardRepo.save(
			this.cardRepo.create({
				boardId: board.id,
				columnId: column.id,
				title: body.title.trim(),
				description: body.description?.trim() || null,
				orderIndex,
				conversationId: body.conversationId || null,
				assignedUserId: body.assignedUserId || null,
				dueAt: body.dueAt ? new Date(body.dueAt) : null,
				createdByUserId: user.id,
				labels: [],
				checklist: [],
				comments: [],
				attachments: [],
			}),
		);
		return this.toCardDto(card, []);
	}

	async createCardFromMessages(
		user: User,
		accountId: string,
		body: CreateBoardCardFromMessagesDto,
	) {
		await this.access.assertConversationVisible(user, body.conversationId);
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const messageIds = [...new Set(body.messageIds || [])].filter(Boolean);
		if (!messageIds.length) {
			throw new BadRequestException('Select at least one message');
		}
		const messages = await this.messageRepo.find({
			where: { id: In(messageIds), conversationId: body.conversationId },
		});
		if (messages.length !== messageIds.length) {
			throw new BadRequestException('Some selected messages were not found in this chat');
		}
		let column: WhatsAppBoardColumn;
		if (body.columnId) {
			column = await this.requireColumn(board.id, body.columnId);
		} else {
			column =
				(await this.columnRepo.findOne({
					where: { boardId: board.id },
					order: { orderIndex: 'ASC' },
				})) || (await this.createDefaultColumn(board.id));
		}
		const snippets = messages
			.map((message) => this.messageSnippet(message))
			.filter(Boolean);
		const title =
			body.title?.trim() ||
			snippets[0]?.slice(0, 120) ||
			(messages[0]?.type === 'ptt' || messages[0]?.type === 'audio'
				? 'Voice note'
				: 'WhatsApp task');
		const description = snippets.join('\n\n').slice(0, 8000) || null;
		const orderIndex = await this.nextCardOrder(column.id);
		const card = await this.cardRepo.save(
			this.cardRepo.create({
				boardId: board.id,
				columnId: column.id,
				title,
				description,
				orderIndex,
				conversationId: body.conversationId,
				createdByUserId: user.id,
				labels: [],
				checklist: [],
				comments: [],
				attachments: [],
			}),
		);
		const links = await this.linkRepo.save(
			messages.map((message) =>
				this.linkRepo.create({
					cardId: card.id,
					messageId: message.id,
					conversationId: body.conversationId,
					snippet: this.messageSnippet(message),
					messageType: message.type || null,
				}),
			),
		);
		return this.toCardDto(card, links);
	}

	async updateCard(
		user: User,
		accountId: string,
		cardId: string,
		body: UpdateBoardCardDto,
	) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const card = await this.requireCard(board.id, cardId);
		if (card.deleted_at) {
			throw new NotFoundException('Card not found');
		}
		if (body.title != null) card.title = body.title.trim();
		if (body.description !== undefined) card.description = body.description?.trim() || null;
		if (body.columnId) {
			await this.requireColumn(board.id, body.columnId);
			card.columnId = body.columnId;
		}
		if (body.orderIndex != null) card.orderIndex = body.orderIndex;
		if (body.conversationId !== undefined) {
			if (body.conversationId) {
				await this.access.assertConversationVisible(user, body.conversationId);
			}
			card.conversationId = body.conversationId;
		}
		if (body.assignedUserId !== undefined) card.assignedUserId = body.assignedUserId;
		if (body.dueAt !== undefined) card.dueAt = body.dueAt ? new Date(body.dueAt) : null;
		if (body.priority != null) {
			const allowed = new Set(['low', 'medium', 'high', 'urgent']);
			const next = String(body.priority).toLowerCase();
			if (allowed.has(next)) {
				card.priority = next;
				card.isStarred = next === 'high' || next === 'urgent';
			}
		} else if (body.isStarred != null) {
			card.isStarred = body.isStarred;
			if (body.isStarred && card.priority !== 'urgent') card.priority = 'high';
			if (!body.isStarred && (card.priority === 'high' || card.priority === 'urgent')) {
				card.priority = 'medium';
			}
		}
		if (body.isCompleted != null) card.isCompleted = body.isCompleted;
		if (body.labels) card.labels = body.labels;
		if (body.checklist) card.checklist = body.checklist;
		if (body.comments) card.comments = body.comments;
		if (body.attachments) card.attachments = body.attachments;
		if (body.coverImageUrl !== undefined) card.coverImageUrl = body.coverImageUrl;
		await this.cardRepo.save(card);
		const links = await this.linkRepo.find({ where: { cardId: card.id } });
		return this.toCardDto(card, links);
	}

	async moveCard(user: User, accountId: string, cardId: string, body: MoveBoardCardDto) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const card = await this.requireCard(board.id, cardId);
		await this.requireColumn(board.id, body.columnId);
		card.columnId = body.columnId;
		if (body.orderIndex != null) {
			card.orderIndex = body.orderIndex;
		} else {
			card.orderIndex = await this.nextCardOrder(body.columnId);
		}
		await this.cardRepo.save(card);
		const links = await this.linkRepo.find({ where: { cardId: card.id } });
		return this.toCardDto(card, links);
	}

	async reorderCards(user: User, accountId: string, body: ReorderBoardCardsDto) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		await this.requireColumn(board.id, body.columnId);
		for (let index = 0; index < body.cardIds.length; index += 1) {
			await this.cardRepo.update(
				{ id: body.cardIds[index], boardId: board.id, columnId: body.columnId },
				{ orderIndex: index },
			);
		}
		return this.loadBoardPayload(board.id, user, accountId);
	}

	async deleteCard(user: User, accountId: string, cardId: string) {
		const board = await this.requireDefaultBoard(user, accountId, 'canUse');
		const card = await this.requireCard(board.id, cardId);
		await this.linkRepo.softDelete({ cardId: card.id });
		await this.cardRepo.softDelete({ id: card.id, boardId: board.id });
		return { deleted: true, cardId };
	}

	private async loadBoardPayload(boardId: string, user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const board = await this.boardRepo.findOne({ where: { id: boardId, accountId } });
		if (!board) throw new NotFoundException('Board not found');
		const columns = await this.columnRepo.find({
			where: { boardId: board.id },
			order: { orderIndex: 'ASC' },
		});
		const cards = await this.cardRepo.find({
			where: { boardId: board.id },
			order: { orderIndex: 'ASC' },
		});
		const links = cards.length
			? await this.linkRepo.find({ where: { cardId: In(cards.map((item) => item.id)) } })
			: [];
		const linksByCard = new Map<string, WhatsAppBoardCardLink[]>();
		for (const link of links) {
			const bucket = linksByCard.get(link.cardId) || [];
			bucket.push(link);
			linksByCard.set(link.cardId, bucket);
		}
		const cardsByColumn = new Map<string, ReturnType<typeof this.toCardDto>[]>();
		for (const card of cards) {
			const bucket = cardsByColumn.get(card.columnId) || [];
			bucket.push(this.toCardDto(card, linksByCard.get(card.id) || []));
			cardsByColumn.set(card.columnId, bucket);
		}
		return {
			board: {
				id: board.id,
				name: board.name,
				isDefault: board.isDefault,
			},
			lists: columns.map((column) =>
				this.toColumnDto(column, cardsByColumn.get(column.id) || []),
			),
			cards: cards.map((card) =>
				this.toCardDto(card, linksByCard.get(card.id) || []),
			),
		};
	}

	private async requireDefaultBoard(
		user: User,
		accountId: string,
		permission: 'canView' | 'canUse',
	) {
		await this.access.assertAccountPermission(user, accountId, permission);
		const board = await this.boardRepo.findOne({
			where: { accountId, isDefault: true },
		});
		if (!board) {
			const payload = await this.getDefaultBoard(user, accountId);
			const found = await this.boardRepo.findOne({
				where: { id: payload.board.id },
			});
			if (!found) throw new NotFoundException('Board not found');
			return found;
		}
		return board;
	}

	private async requireColumn(boardId: string, columnId: string) {
		const column = await this.columnRepo.findOne({ where: { id: columnId, boardId } });
		if (!column) throw new NotFoundException('Column not found');
		return column;
	}

	private async requireCard(boardId: string, cardId: string) {
		const card = await this.cardRepo.findOne({ where: { id: cardId, boardId } });
		if (!card) throw new NotFoundException('Card not found');
		return card;
	}

	private async cardsForColumn(columnId: string) {
		const cards = await this.cardRepo.find({
			where: { columnId },
			order: { orderIndex: 'ASC' },
		});
		if (!cards.length) return [];
		const links = await this.linkRepo.find({ where: { cardId: In(cards.map((c) => c.id)) } });
		const linksByCard = new Map<string, WhatsAppBoardCardLink[]>();
		for (const link of links) {
			const bucket = linksByCard.get(link.cardId) || [];
			bucket.push(link);
			linksByCard.set(link.cardId, bucket);
		}
		return cards.map((card) => this.toCardDto(card, linksByCard.get(card.id) || []));
	}

	private async nextCardOrder(columnId: string) {
		const row = await this.cardRepo
			.createQueryBuilder('card')
			.select('MAX(card.orderIndex)', 'max')
			.where('card.columnId = :columnId', { columnId })
			.getRawOne<{ max: string | null }>();
		return (Number(row?.max) || 0) + 1;
	}

	private async createDefaultColumn(boardId: string) {
		return this.columnRepo.save(
			this.columnRepo.create({
				boardId,
				name: 'To Do',
				color: '#667eea',
				orderIndex: 0,
			}),
		);
	}

	private messageSnippet(message: WhatsAppMessage) {
		const text = String(message.text || '').trim();
		if (text) return text;
		const type = String(message.type || '').toLowerCase();
		if (type.includes('audio') || type === 'ptt' || type === 'voice') return '[Voice message]';
		if (type.includes('image')) return '[Image]';
		if (type.includes('video')) return '[Video]';
		if (type.includes('document')) return '[Document]';
		return `[${type || 'message'}]`;
	}

	private toColumnDto(column: WhatsAppBoardColumn, cards: ReturnType<typeof this.toCardDto>[]) {
		return {
			id: column.id,
			title: column.name,
			color: column.color,
			orderIndex: column.orderIndex,
			cards,
		};
	}

	private toCardDto(card: WhatsAppBoardCard, links: WhatsAppBoardCardLink[]) {
		const createdRaw = (card as WhatsAppBoardCard & { created_at?: Date }).created_at;
		const updatedRaw = (card as WhatsAppBoardCard & { updated_at?: Date }).updated_at;
		const createdAt =
			createdRaw instanceof Date
				? createdRaw.toISOString()
				: createdRaw
					? String(createdRaw)
					: null;
		const updatedAt =
			updatedRaw instanceof Date
				? updatedRaw.toISOString()
				: updatedRaw
					? String(updatedRaw)
					: null;
		return {
			id: card.id,
			listId: card.columnId,
			columnId: card.columnId,
			boardId: card.boardId,
			title: card.title,
			description: card.description || '',
			dueDate: card.dueAt ? card.dueAt.toISOString().slice(0, 10) : null,
			dueAt: card.dueAt,
			isStarred: card.isStarred,
			priority: card.priority || (card.isStarred ? 'high' : 'medium'),
			isCompleted: Boolean(card.isCompleted),
			labels: card.labels || [],
			checklist: card.checklist || [],
			comments: card.comments || [],
			attachments: card.attachments || [],
			coverImage: card.coverImageUrl,
			conversationId: card.conversationId,
			assignedUserId: card.assignedUserId,
			orderIndex: card.orderIndex,
			createdAt,
			updatedAt,
			links: links.map((link) => ({
				id: link.id,
				messageId: link.messageId,
				conversationId: link.conversationId,
				snippet: link.snippet,
				messageType: link.messageType,
			})),
		};
	}
}
