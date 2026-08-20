import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppChatMessageGroup,
	WhatsAppChatMessageGroupItem,
	WhatsAppMessage,
} from '../entities/whatsapp.entity';
import { WhatsAppAccessService } from './whatsapp-access.service';

const MAX_GROUP_NAME = 120;
const MAX_GROUPS_PER_CHAT = 80;
const MAX_MESSAGES_PER_OP = 100;

@Injectable()
export class WhatsAppMessageGroupsService {
	constructor(
		@InjectRepository(WhatsAppChatMessageGroup)
		private readonly groupRepo: Repository<WhatsAppChatMessageGroup>,
		@InjectRepository(WhatsAppChatMessageGroupItem)
		private readonly itemRepo: Repository<WhatsAppChatMessageGroupItem>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly access: WhatsAppAccessService,
	) {}

	async list(user: User, conversationId: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const groups = await this.groupRepo.find({
			where: { conversationId, userId: user.id },
			order: { updated_at: 'DESC' },
			take: MAX_GROUPS_PER_CHAT,
		});
		if (!groups.length) return { items: [] };
		const counts = await this.itemRepo
			.createQueryBuilder('item')
			.select('item.groupId', 'groupId')
			.addSelect('COUNT(*)', 'count')
			.where('item.groupId IN (:...ids)', { ids: groups.map((item) => item.id) })
			.andWhere('item.userId = :userId', { userId: user.id })
			.groupBy('item.groupId')
			.getRawMany<{ groupId: string; count: string }>();
		const countById = new Map(counts.map((row) => [row.groupId, Number(row.count) || 0]));
		return {
			items: groups.map((group) => this.toGroupDto(group, countById.get(group.id) || 0)),
		};
	}

	async create(user: User, conversationId: string, name: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const trimmed = this.normalizeName(name);
		const existingCount = await this.groupRepo.count({
			where: { conversationId, userId: user.id },
		});
		if (existingCount >= MAX_GROUPS_PER_CHAT) {
			throw new BadRequestException(`You can create at most ${MAX_GROUPS_PER_CHAT} groups per chat`);
		}
		const duplicate = await this.findByName(conversationId, user.id, trimmed);
		if (duplicate) {
			throw new BadRequestException('A group with this name already exists in this chat');
		}
		const group = await this.groupRepo.save(
			this.groupRepo.create({
				conversationId,
				userId: user.id,
				name: trimmed,
			}),
		);
		return this.toGroupDto(group, 0);
	}

	async rename(user: User, conversationId: string, groupId: string, name: string) {
		const group = await this.requireGroup(user, conversationId, groupId);
		const trimmed = this.normalizeName(name);
		const duplicate = await this.findByName(conversationId, user.id, trimmed);
		if (duplicate && duplicate.id !== group.id) {
			throw new BadRequestException('A group with this name already exists in this chat');
		}
		group.name = trimmed;
		await this.groupRepo.save(group);
		const count = await this.itemRepo.count({ where: { groupId: group.id, userId: user.id } });
		return this.toGroupDto(group, count);
	}

	async remove(user: User, conversationId: string, groupId: string) {
		const group = await this.requireGroup(user, conversationId, groupId);
		await this.itemRepo.softDelete({ groupId: group.id, userId: user.id });
		await this.groupRepo.softRemove(group);
		return { deleted: true, groupId: group.id };
	}

	async addMessages(
		user: User,
		conversationId: string,
		groupId: string,
		messageIds: string[],
	) {
		const group = await this.requireGroup(user, conversationId, groupId);
		const ids = this.normalizeMessageIds(messageIds);
		const messages = await this.messageRepo.find({
			where: { id: In(ids), conversationId },
		});
		if (messages.length !== ids.length) {
			throw new BadRequestException('Some selected messages were not found in this chat');
		}
		const existing = await this.itemRepo.find({
			where: { messageId: In(ids), userId: user.id },
			withDeleted: true,
		});
		const byMessageId = new Map(existing.map((item) => [item.messageId, item]));
		let added = 0;
		let moved = 0;
		for (const message of messages) {
			const row = byMessageId.get(message.id);
			if (row && !row.deleted_at && row.groupId === group.id) continue;
			if (row) {
				if (row.deleted_at) await this.itemRepo.recover(row);
				if (row.groupId !== group.id) moved += 1;
				row.groupId = group.id;
				row.conversationId = conversationId;
				row.userId = user.id;
				row.messageId = message.id;
				await this.itemRepo.save(row);
				added += 1;
				continue;
			}
			await this.itemRepo.save(
				this.itemRepo.create({
					groupId: group.id,
					conversationId,
					messageId: message.id,
					userId: user.id,
				}),
			);
			added += 1;
		}
		group.updated_at = new Date();
		await this.groupRepo.save(group);
		const count = await this.itemRepo.count({ where: { groupId: group.id, userId: user.id } });
		return {
			...this.toGroupDto(group, count),
			added,
			moved,
		};
	}

	async removeMessages(
		user: User,
		conversationId: string,
		groupId: string,
		messageIds: string[],
	) {
		const group = await this.requireGroup(user, conversationId, groupId);
		const ids = this.normalizeMessageIds(messageIds);
		const result = await this.itemRepo.softDelete({
			groupId: group.id,
			userId: user.id,
			messageId: In(ids),
		});
		const count = await this.itemRepo.count({ where: { groupId: group.id, userId: user.id } });
		return {
			...this.toGroupDto(group, count),
			removed: result.affected || 0,
		};
	}

	async membershipMap(user: User, conversationId: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const items = await this.itemRepo.find({
			where: { conversationId, userId: user.id },
			relations: ['group'],
			take: 5000,
		});
		const map: Record<string, { groupId: string; groupName: string }> = {};
		for (const item of items) {
			if (!item.group || item.group.deleted_at) continue;
			map[item.messageId] = {
				groupId: item.groupId,
				groupName: item.group.name,
			};
		}
		return { membership: map };
	}

	async listGroupMessages(user: User, conversationId: string, groupId: string) {
		const group = await this.requireGroup(user, conversationId, groupId);
		const items = await this.itemRepo.find({
			where: { groupId: group.id, userId: user.id, conversationId },
			order: { created_at: 'ASC' },
			take: 2000,
		});
		const messageIds = items.map((item) => item.messageId);
		if (!messageIds.length) {
			return { ...this.toGroupDto(group, 0), messages: [] };
		}
		const messages = await this.messageRepo.find({
			where: { id: In(messageIds), conversationId },
			relations: ['attachments', 'reactions', 'senderUser'],
			order: { providerTimestamp: 'ASC' },
		});
		const byId = new Map(messages.map((message) => [message.id, message]));
		const ordered = messageIds
			.map((id) => byId.get(id))
			.filter(Boolean)
			.sort(
				(a, b) =>
					new Date(a!.providerTimestamp).getTime() - new Date(b!.providerTimestamp).getTime(),
			);
		return {
			...this.toGroupDto(group, ordered.length),
			messages: ordered.map((message) => ({
				...message,
				messageGroupId: group.id,
				messageGroupName: group.name,
			})),
		};
	}

	private async requireGroup(user: User, conversationId: string, groupId: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const group = await this.groupRepo.findOne({
			where: { id: groupId, conversationId, userId: user.id },
		});
		if (!group) throw new NotFoundException('Message group not found');
		return group;
	}

	private async findByName(conversationId: string, userId: string, name: string) {
		return this.groupRepo
			.createQueryBuilder('group')
			.where('group.conversationId = :conversationId', { conversationId })
			.andWhere('group.userId = :userId', { userId })
			.andWhere('LOWER(group.name) = LOWER(:name)', { name })
			.getOne();
	}

	private normalizeName(name: string) {
		const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
		if (trimmed.length < 1) throw new BadRequestException('Group name is required');
		if (trimmed.length > MAX_GROUP_NAME) {
			throw new BadRequestException(`Group name must be at most ${MAX_GROUP_NAME} characters`);
		}
		return trimmed;
	}

	private normalizeMessageIds(messageIds: string[]) {
		const ids = [...new Set((messageIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
		if (!ids.length) throw new BadRequestException('Select at least one message');
		if (ids.length > MAX_MESSAGES_PER_OP) {
			throw new BadRequestException(`You can move at most ${MAX_MESSAGES_PER_OP} messages at once`);
		}
		return ids;
	}

	private toGroupDto(group: WhatsAppChatMessageGroup, messageCount: number) {
		return {
			id: group.id,
			conversationId: group.conversationId,
			name: group.name,
			messageCount,
			createdAt: group.created_at,
			updatedAt: group.updated_at,
		};
	}
}
