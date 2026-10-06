// src/chat/chat.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User, UserRole, Feedback, FeedbackType, FeedbackStatus } from 'entities/global.entity';
import { ChatConversation, ChatMessage, ChatParticipant } from 'entities/global.entity';


const DEFAULT_CHAT_SETTINGS = {
	notificationsEnabled: true,
	showPreview: true,
	sound: true,
	vibration: true,
	badge: true,
	backgroundOnly: false,
	groupByConversation: true,
	blockedUserIds: [] as string[],
};

const CHAT_USER_SELECT: (keyof User)[] = ['id', 'name', 'email', 'phone', 'role', 'status', 'coachId', 'adminId'];


@Injectable()
export class ChatService {
	constructor(
		@InjectRepository(ChatConversation) private conversationRepo: Repository<ChatConversation>,
		@InjectRepository(ChatMessage) private messageRepo: Repository<ChatMessage>,
		@InjectRepository(ChatParticipant) private participantRepo: Repository<ChatParticipant>,
		@InjectRepository(User) private userRepo: Repository<User>,
		@InjectRepository(Feedback) private feedbackRepo: Repository<Feedback>,
	) { }


	async registerExpoPushToken(userId: string, expoPushToken: string) {
		const user = await this.userRepo.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');

		const current = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
		const next = Array.from(new Set([...current, expoPushToken]));

		await this.userRepo.update(userId, { expoPushTokens: next });
		return { success: true, expoPushTokens: next };
	}

	async unregisterExpoPushToken(userId: string, expoPushToken: string) {
		const user = await this.userRepo.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');

		const current = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
		const next = current.filter(token => token !== expoPushToken);

		await this.userRepo.update(userId, { expoPushTokens: next });
		return { success: true };
	}

	async getChatSettings(userId: string) {
		const user = await this.userRepo.findOne({
			where: { id: userId },
			select: ['id', 'chatSettings'],
		});

		if (!user) throw new NotFoundException('User not found');

		return {
			...DEFAULT_CHAT_SETTINGS,
			...(user.chatSettings || {}),
		};
	}

	async updateChatSettings(
		userId: string,
		partial: Partial<{
			notificationsEnabled: boolean;
			showPreview: boolean;
			sound: boolean;
			vibration: boolean;
			badge: boolean;
			backgroundOnly: boolean;
			groupByConversation: boolean;
			blockedUserIds: string[];
		}>,
	) {
		const user = await this.userRepo.findOne({
			where: { id: userId },
			select: ['id', 'chatSettings'],
		});

		if (!user) throw new NotFoundException('User not found');

		const next = {
			...DEFAULT_CHAT_SETTINGS,
			...(user.chatSettings || {}),
			...partial,
		};

		await this.userRepo.update(userId, { chatSettings: next });
		return next;
	}

	private blockedIdsFromSettings(settings: any): string[] {
		const raw = settings?.blockedUserIds;
		return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
	}

	async blockUser(actorId: string, targetUserId: string) {
		if (!targetUserId || targetUserId === actorId) {
			throw new BadRequestException('Invalid user to block');
		}
		const settings = await this.getChatSettings(actorId);
		const blocked = new Set(this.blockedIdsFromSettings(settings));
		blocked.add(String(targetUserId));
		return this.updateChatSettings(actorId, { blockedUserIds: Array.from(blocked) });
	}

	async unblockUser(actorId: string, targetUserId: string) {
		const settings = await this.getChatSettings(actorId);
		const next = this.blockedIdsFromSettings(settings).filter(id => id !== String(targetUserId));
		return this.updateChatSettings(actorId, { blockedUserIds: next });
	}

	async reportContent(
		reporterId: string,
		body: {
			conversationId?: string;
			messageId?: string;
			reportedUserId?: string;
			reason?: string;
			details?: string;
		},
	) {
		const reporter = await this.userRepo.findOne({ where: { id: reporterId } });
		if (!reporter) throw new NotFoundException('User not found');

		const reason = String(body?.reason || 'inappropriate').slice(0, 120);
		const details = String(body?.details || '').slice(0, 2000);
		const title = `Chat report: ${reason}`;
		const description = [
			`Reporter: ${reporter.email || reporterId}`,
			body?.reportedUserId ? `Reported user: ${body.reportedUserId}` : null,
			body?.conversationId ? `Conversation: ${body.conversationId}` : null,
			body?.messageId ? `Message: ${body.messageId}` : null,
			details ? `Details: ${details}` : null,
		]
			.filter(Boolean)
			.join('\n');

		const feedback = this.feedbackRepo.create({
			type: FeedbackType.ISSUE,
			title,
			description,
			email: reporter.email || null,
			name: reporter.name || null,
			category: 'chat_moderation',
			userId: reporterId,
			status: FeedbackStatus.NEW,
		});
		await this.feedbackRepo.save(feedback);

		return { success: true, id: feedback.id };
	}

	// chat.service.ts
	async getUnreadOverview(userId: string) {
		// One grouped query: unread per conversation + total
		const rows = await this.messageRepo
			.createQueryBuilder('m')
			.select('c.id', 'conversationId')
			.addSelect(
				`
      COUNT(m.id) FILTER (
        WHERE m.isDeleted = false
          AND m.senderId != :userId
          AND (p.lastReadAt IS NULL OR m.created_at > p.lastReadAt)
      )
    `,
				'unread',
			)
			.innerJoin('m.conversation', 'c')
			.innerJoin(ChatParticipant, 'p', 'p.conversationId = c.id AND p.userId = :userId AND p.isActive = true', { userId })
			.groupBy('c.id')
			.getRawMany<{ conversationId: string; unread: string }>();

		const conversations = rows.map(r => ({ id: r.conversationId, unreadCount: Number(r.unread) }));
		const totalUnread = conversations.reduce((a, b) => a + b.unreadCount, 0);

		return { totalUnread, conversations };
	}

	async getUserConversations(userId: string, page: number = 1, limit: number = 50) {
		const skip = (Math.max(1, page || 1) - 1) * Math.max(1, limit || 1);
		const take = Math.max(1, limit || 1);

		try {
			const participants = await this.participantRepo.find({
				where: {
					user: { id: userId },
					isActive: true,
				},
				relations: ['conversation', 'conversation.chatParticipants', 'conversation.chatParticipants.user'],
				order: {
					conversation: {
						lastMessageAt: 'DESC',
					},
				},
				skip,
				take,
			});

			const conversations = await Promise.all(
				participants.map(async p => {
					const conversation = p.conversation;

					// Get last message
					const lastMessage = await this.messageRepo.findOne({
						where: { conversation: { id: conversation.id } },
						relations: ['sender'],
						order: { created_at: 'DESC' },
					});

					// Calculate unread count
					const unreadCount = await this.getUnreadCount(conversation.id, userId);

					return {
						...conversation,
						lastMessage,
						unreadCount,
					};
				}),
			);

			const settings = await this.getChatSettings(userId);
			const blocked = new Set(this.blockedIdsFromSettings(settings));
			const filtered =
				blocked.size === 0
					? conversations
					: conversations.filter(c => {
							const others = (c.chatParticipants || [])
								.map((cp: any) => cp?.user?.id || cp?.userId)
								.filter((id: string) => id && id !== userId);
							return !others.some((id: string) => blocked.has(String(id)));
					  });

			return filtered;
		} catch (error) {
			console.error('Error loading conversations:', error);
			throw new Error('Failed to load conversations');
		}
	}

	private async getUnreadCount(conversationId: string, userId: string): Promise<number> {
		const participant = await this.participantRepo.findOne({
			where: {
				conversation: { id: conversationId },
				user: { id: userId },
			},
		});

		if (!participant?.lastReadAt) {
			// If never read, count all messages from others
			return await this.messageRepo.createQueryBuilder('message').where('message.conversationId = :conversationId', { conversationId }).andWhere('message.senderId != :userId', { userId }).andWhere('message.isDeleted = false').getCount();
		}

		// Count messages after last read date
		return await this.messageRepo
			.createQueryBuilder('message')
			.where('message.conversationId = :conversationId', { conversationId })
			.andWhere('message.created_at > :lastRead', {
				lastRead: participant.lastReadAt,
			})
			.andWhere('message.senderId != :userId', { userId })
			.andWhere('message.isDeleted = false')
			.getCount();
	}

	async getConversationMessages(conversationId: string, userId: string, page: number = 1, limit: number = 50) {
		// Verify user is participant
		const participant = await this.participantRepo.findOne({
			where: {
				conversation: { id: conversationId },
				user: { id: userId },
				isActive: true,
			},
		});

		if (!participant) {
			throw new NotFoundException('Conversation not found');
		}

		const take = Math.max(1, limit || 20);
		const total = await this.messageRepo.count({
			where: { conversation: { id: conversationId }, isDeleted: false },
		});
		const skip = Math.max(0, total - take * page);

		const messages = await this.messageRepo.find({
			where: { conversation: { id: conversationId }, isDeleted: false },
			relations: ['sender', 'replyTo', 'replyTo.sender'],
			order: { created_at: 'ASC' },  // always ASC
			skip,
			take,
		});
		await this.markConversationAsRead(conversationId, userId);

		return messages
	}

	async markConversationAsRead(conversationId: string, userId: string) {
		// Update participant's last read time
		await this.participantRepo.update(
			{
				conversation: { id: conversationId },
				user: { id: userId },
			},
			{
				lastReadAt: new Date(),
			},
		);

		// For messages that don't have readBy set yet, set them to current time
		// This tracks when the message was first read
		await this.messageRepo.createQueryBuilder().update(ChatMessage).set({ readBy: new Date() }).where('conversationId = :conversationId', { conversationId }).andWhere('senderId != :userId', { userId }).andWhere('readBy IS NULL').execute();
	}
	// ... rest of your existing methods remain the same
	async addParticipants(conversationId: string, userIds: string[], addedBy: string) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
			relations: ['chatParticipants', 'chatParticipants.user'],
		});

		if (!conversation) {
			throw new NotFoundException('Conversation not found');
		}

		// Check if adder is admin
		const adder = conversation.chatParticipants.find(p => p.user.id === addedBy);
		if (!adder?.isAdmin) {
			throw new BadRequestException('Only admins can add participants');
		}

		const existingUserIds = conversation.chatParticipants.map(p => p.user.id);
		const newUserIds = userIds.filter(id => !existingUserIds.includes(id));

		const newUsers = await this.userRepo.find({ where: { id: In(newUserIds) } });
		const newParticipants = newUsers.map(user =>
			this.participantRepo.create({
				conversation,
				user,
				isAdmin: false,
			}),
		);

		await this.participantRepo.save(newParticipants);

		return this.conversationRepo.findOne({
			where: { id: conversationId },
			relations: ['chatParticipants', 'chatParticipants.user'],
		});
	}

	async removeParticipant(conversationId: string, userId: string, removedBy: string) {
		const participant = await this.participantRepo.findOne({
			where: {
				conversation: { id: conversationId },
				user: { id: userId },
			},
			relations: ['conversation', 'conversation.chatParticipants'],
		});

		if (!participant) {
			throw new NotFoundException('Participant not found');
		}

		// Check if remover is admin or the user themselves
		const remover = participant.conversation.chatParticipants.find(p => p.user.id === removedBy);
		if (!remover?.isAdmin && removedBy !== userId) {
			throw new BadRequestException('Cannot remove participant');
		}

		await this.participantRepo.update({ conversation: { id: conversationId }, user: { id: userId } }, { isActive: false });

		return { success: true };
	}

	async getConversationForCoach(coachId: string, clientId?: string) {
		let query = this.conversationRepo.createQueryBuilder('conversation').innerJoin('conversation.chatParticipants', 'participant', 'participant.userId = :coachId AND participant.isActive = true', { coachId }).innerJoin('conversation.chatParticipants', 'clientParticipant').innerJoin('clientParticipant.user', 'client').leftJoinAndSelect('conversation.chatParticipants', 'participants').leftJoinAndSelect('participants.user', 'user').where('conversation.isGroup = false').andWhere('client.role = :clientRole', { clientRole: UserRole.CLIENT });

		if (clientId) {
			query = query.andWhere('client.id = :clientId', { clientId });
		}

		return query.getMany();
	}

	async searchConversations(userId: string, query: string) {
		return this.conversationRepo
			.createQueryBuilder('conversation')
			.innerJoin('conversation.chatParticipants', 'participant', 'participant.userId = :userId AND participant.isActive = true', { userId })
			.leftJoinAndSelect('conversation.chatParticipants', 'participants')
			.leftJoinAndSelect('participants.user', 'user')
			.where('conversation.name ILIKE :query', { query: `%${query}%` })
			.orWhere('user.name ILIKE :query', { query: `%${query}%` })
			.orWhere('user.email ILIKE :query', { query: `%${query}%` })
			.orderBy('conversation.lastMessageAt', 'DESC')
			.getMany();
	}

	private sanitizeChatUser(user: User | null | undefined) {
		if (!user) return null;
		return {
			id: user.id,
			name: user.name,
			email: user.email,
			phone: user.phone ?? null,
			role: user.role,
			status: user.status,
			coachId: user.coachId ?? null,
			adminId: user.adminId ?? null,
		};
	}

	/** Who may open a direct chat with whom (gym / coach tree). */
	private async assertCanChatWith(actor: User, target: User) {
		if (!actor || !target) throw new NotFoundException('User not found');
		if (actor.id === target.id) throw new BadRequestException('Cannot chat with yourself');
		if (actor.role === UserRole.SUPER_ADMIN) return;

		if (actor.role === UserRole.ADMIN) {
			const ok =
				target.adminId === actor.id ||
				(target.role === UserRole.ADMIN && target.id === actor.id) ||
				(target.tenantId && actor.tenantId && target.tenantId === actor.tenantId && target.role !== UserRole.SUPER_ADMIN);
			if (!ok) throw new ForbiddenException('Not allowed to chat with this user');
			return;
		}

		if (actor.role === UserRole.COACH) {
			const ok =
				(target.role === UserRole.CLIENT && target.coachId === actor.id) ||
				(target.role === UserRole.ADMIN && target.id === actor.adminId) ||
				(target.role === UserRole.COACH && target.adminId && target.adminId === actor.adminId);
			if (!ok) throw new ForbiddenException('Not allowed to chat with this user');
			return;
		}

		if (actor.role === UserRole.CLIENT) {
			const ok =
				(target.role === UserRole.COACH && target.id === actor.coachId) ||
				(target.role === UserRole.ADMIN && target.id === actor.adminId);
			if (!ok) throw new ForbiddenException('Not allowed to chat with this user');
			return;
		}

		throw new ForbiddenException('Not allowed to chat with this user');
	}

	async searchUsers(currentUserId: string, query: string, role?: UserRole) {
		const q = String(query || '').trim();
		if (q.length < 1) return [];

		const actor = await this.userRepo.findOne({
			where: { id: currentUserId },
			select: [...CHAT_USER_SELECT, 'tenantId'] as any,
		});
		if (!actor) throw new NotFoundException('User not found');

		const qb = this.userRepo
			.createQueryBuilder('u')
			.select([
				'u.id',
				'u.name',
				'u.email',
				'u.phone',
				'u.role',
				'u.status',
				'u.coachId',
				'u.adminId',
			])
			.where('u.id != :me', { me: currentUserId })
			.andWhere('(u.name ILIKE :q OR u.email ILIKE :q)', { q: `%${q}%` })
			.orderBy('u.name', 'ASC')
			.take(20);

		if (role) qb.andWhere('u.role = :role', { role });

		if (actor.role === UserRole.SUPER_ADMIN) {
			// unrestricted
		} else if (actor.role === UserRole.ADMIN) {
			if (actor.tenantId) {
				qb.andWhere(
					'(u.adminId = :adminId OR (u.tenantId = :tenantId AND u.role != :sa))',
					{ adminId: actor.id, tenantId: actor.tenantId, sa: UserRole.SUPER_ADMIN },
				);
			} else {
				qb.andWhere('u.adminId = :adminId', { adminId: actor.id });
			}
		} else if (actor.role === UserRole.COACH) {
			qb.andWhere(
				'((u.role = :client AND u.coachId = :coachId) OR (u.role = :admin AND u.id = :adminId) OR (u.role = :coach AND u.adminId = :adminId AND u.id != :me))',
				{
					client: UserRole.CLIENT,
					admin: UserRole.ADMIN,
					coach: UserRole.COACH,
					coachId: actor.id,
					adminId: actor.adminId,
					me: currentUserId,
				},
			);
		} else if (actor.role === UserRole.CLIENT) {
			const ids = [actor.coachId, actor.adminId].filter(Boolean);
			if (!ids.length) return [];
			qb.andWhere('u.id IN (:...ids)', { ids });
		} else {
			return [];
		}

		const rows = await qb.getMany();
		return rows.map(u => this.sanitizeChatUser(u));
	}

	async createConversation(createdBy: User, participantIds: string[], name?: string, isGroup: boolean = false) {
		if (!isGroup && participantIds.length !== 1) {
			throw new BadRequestException('Direct conversation must have exactly 1 participant');
		}

		// For direct messages, check if conversation already exists
		if (!isGroup) {
			const existing = await this.conversationRepo.createQueryBuilder('c').innerJoin('c.chatParticipants', 'p1', 'p1.userId = :userId1', { userId1: createdBy.id }).innerJoin('c.chatParticipants', 'p2', 'p2.userId = :userId2', { userId2: participantIds[0] }).where('c.isGroup = false').getOne();

			if (existing) {
				return this.conversationRepo.findOne({
					where: { id: existing.id },
					relations: ['chatParticipants', 'chatParticipants.user'],
				});
			}
		}

		const conversation = this.conversationRepo.create({
			name,
			isGroup,
			createdBy,
		});

		const savedConversation = await this.conversationRepo.save(conversation);

		// Add creator as participant
		const creatorParticipant = this.participantRepo.create({
			conversation: savedConversation,
			user: createdBy,
			isAdmin: true,
		});

		// Add other participants
		const otherUsers = await this.userRepo.find({ where: { id: In(participantIds) } });
		const otherParticipants = otherUsers.map(user =>
			this.participantRepo.create({
				conversation: savedConversation,
				user,
				isAdmin: isGroup ? false : true,
			}),
		);

		await this.participantRepo.save([creatorParticipant, ...otherParticipants]);

		// Update lastMessageAt to avoid null issues
		await this.conversationRepo.update(savedConversation.id, {
			lastMessageAt: new Date(),
		});

		return this.conversationRepo.findOne({
			where: { id: savedConversation.id },
			relations: ['chatParticipants', 'chatParticipants.user'],
		});
	}

	async getOrCreateDirectConversation(currentUserId: string, targetUserId: string) {
		const currentUser = await this.userRepo.findOne({ where: { id: currentUserId } });
		const targetUser = await this.userRepo.findOne({ where: { id: targetUserId } });

		if (!currentUser || !targetUser) {
			throw new NotFoundException('User not found');
		}

		await this.assertCanChatWith(currentUser, targetUser);

		// Check if conversation already exists
		const existingConversation = await this.conversationRepo.createQueryBuilder('conversation').innerJoinAndSelect('conversation.chatParticipants', 'participant1').innerJoinAndSelect('participant1.user', 'user1').innerJoin('conversation.chatParticipants', 'participant2').innerJoin('participant2.user', 'user2').where('user1.id = :currentUserId', { currentUserId }).andWhere('user2.id = :targetUserId', { targetUserId }).andWhere('conversation.isGroup = false').andWhere('participant1.isActive = true').andWhere('participant2.isActive = true').getOne();

		if (existingConversation) {
			return this.conversationRepo.findOne({
				where: { id: existingConversation.id },
				relations: ['chatParticipants', 'chatParticipants.user'],
			});
		}

		// Create new conversation
		return this.createConversation(currentUser, [targetUserId], null, false);
	}
}
