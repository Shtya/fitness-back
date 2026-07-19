import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import {
	NotificationAudience,
	NotificationType,
	User,
} from '../../../entities/global.entity';
import { NotificationService } from '../../notification/notification.service';
import {
	WhatsAppAccount,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppConversationNote,
	WhatsAppConversationType,
	WhatsAppGroup,
	WhatsAppGroupParticipant,
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppMessageDirection,
	WhatsAppMessageStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	NormalizedWhatsAppMessage,
	WhatsAppProvider,
	WhatsAppProviderEvent,
} from '../providers/whatsapp-provider';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { whatsAppTimestampToDate, whatsAppTimestampToMs } from '../utils/whatsapp-time';
import { getWhatsAppPrivacySettings } from '../utils/whatsapp-privacy';

function waId(value: any): string {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value;
	const serialized =
		value?._serialized ||
		value?.id?._serialized ||
		(typeof value?.id === 'string' ? value.id : null) ||
		value?.chatId?._serialized ||
		(typeof value?.chatId === 'string' ? value.chatId : null) ||
		value?.contact?.id?._serialized ||
		(typeof value?.contact?.id === 'string' ? value.contact.id : null);
	return serialized ? String(serialized) : '';
}

function phoneFromWaId(id: string): string | null {
	if (!id) return null;
	const lower = id.toLowerCase();
	if (lower.includes('@lid') || lower.includes('@broadcast') || lower.includes('status@')) {
		return null;
	}
	const user = id.split('@')[0] || '';
	return /^\d{8,15}$/.test(user) ? user : null;
}

function providerMessageId(value: any): string {
	return (
		waId(value?.id) ||
		waId(value?.message?.id) ||
		waId(value?.key) ||
		String(
			value?.id?._serialized ||
				value?.messageId ||
				value?.key?.id ||
				value?.sendMsgResult?.messageId ||
				'',
		)
	);
}

function safeProviderMetadata(raw: any) {
	if (!raw || typeof raw !== 'object') return null;
	return {
		id: providerMessageId(raw) || undefined,
		from: waId(raw.from) || undefined,
		to: waId(raw.to) || undefined,
		author: waId(raw.author) || undefined,
		type: raw.type || undefined,
		timestamp: raw.timestamp || raw.t || undefined,
		ack: raw.ack ?? undefined,
		mimetype: raw.mimetype || undefined,
		filename: raw.filename || undefined,
		size: raw.size || undefined,
		duration:
			Number.isFinite(Number(raw.duration ?? raw.mediaData?.duration))
				? Number(raw.duration ?? raw.mediaData?.duration)
				: undefined,
	};
}

@Injectable()
export class WhatsAppSyncService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppSyncService.name);
	private unsubscribe?: () => void;
	private bootstrapping = new Set<string>();
	private persistQueue: Promise<void> = Promise.resolve();
	private activePersists = 0;
	private readonly maxConcurrentPersists = 1;
	private conversationUpdateTimers = new Map<string, NodeJS.Timeout>();
	private sendOperations = new Map<string, Promise<unknown>>();

	constructor(
		@InjectRepository(WhatsAppAccount)
		private readonly accountRepo: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		@InjectRepository(WhatsAppConversationNote)
		private readonly noteRepo: Repository<WhatsAppConversationNote>,
		@InjectRepository(WhatsAppGroup)
		private readonly groupRepo: Repository<WhatsAppGroup>,
		@InjectRepository(WhatsAppGroupParticipant)
		private readonly participantRepo: Repository<WhatsAppGroupParticipant>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		@InjectRepository(WhatsAppMessageAttachment)
		private readonly attachmentRepo: Repository<WhatsAppMessageAttachment>,
		private readonly access: WhatsAppAccessService,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly gateway: WhatsAppGateway,
		private readonly audit: WhatsAppAuditService,
		private readonly notifications: NotificationService,
	) {}

	onModuleInit() {
		this.unsubscribe = this.providers.onProviderEvent((accountId, event) =>
			this.handleProviderEvent(accountId, event),
		);
	}

	onModuleDestroy() {
		this.unsubscribe?.();
	}

	private requireProvider(accountId: string) {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected') {
			throw new BadRequestException('WhatsApp account is not connected');
		}
		return provider;
	}

	private runIdempotentSend<T>(
		userId: string,
		conversationId: string,
		clientMessageId: string | undefined,
		operation: () => Promise<T>,
	): Promise<T> {
		const id = String(clientMessageId || '').trim();
		if (!id) return operation();
		const key = `${userId}:${conversationId}:${id}`;
		const existing = this.sendOperations.get(key);
		if (existing) return existing as Promise<T>;
		const pending = operation().catch(error => {
			this.sendOperations.delete(key);
			throw error;
		});
		this.sendOperations.set(key, pending);
		const cleanup = setTimeout(() => {
			if (this.sendOperations.get(key) === pending) this.sendOperations.delete(key);
		}, 15 * 60 * 1000);
		cleanup.unref?.();
		return pending;
	}

	private async handleProviderEvent(accountId: string, event: WhatsAppProviderEvent) {
		if (event.type === 'message') {
			this.enqueuePersist(
				() => this.persistMessage(accountId, event.message, null, true),
				`message:${accountId}:${event.message?.providerMessageId || 'unknown'}`,
			);
			return;
		}
		if (event.type === 'connection' && event.status === 'connected') {
			void this.scheduleBootstrap(accountId);
		}
		if (event.type === 'message_status') {
			this.enqueuePersist(async () => {
				const message = await this.messageRepo.findOne({
					where: { accountId, providerMessageId: event.providerMessageId },
				});
				if (message) {
					this.gateway.emitConversationEvent(
						message.conversationId,
						'message_status',
						{
							messageId: message.id,
							providerMessageId: event.providerMessageId,
							status: event.status,
						},
					);
				}
			}, `message_status:${accountId}:${event.providerMessageId}`);
		}
	}

	private enqueuePersist(task: () => Promise<unknown>, context = 'unknown') {
		this.persistQueue = this.persistQueue
			.then(async () => {
				while (this.activePersists >= this.maxConcurrentPersists) {
					await new Promise(resolve => setTimeout(resolve, 25));
				}
				this.activePersists += 1;
				try {
					let lastError: unknown;
					for (let attempt = 1; attempt <= 3; attempt += 1) {
						try {
							await task();
							lastError = undefined;
							break;
						} catch (error) {
							lastError = error;
							this.logger.warn(
								`WhatsApp persistence failed (${context}), attempt ${attempt}/3: ${
									error instanceof Error ? error.message : String(error)
								}`,
							);
							if (attempt < 3) {
								await new Promise(resolve => setTimeout(resolve, attempt * 250));
							}
						}
					}
					if (lastError) {
						this.logger.error(
							`WhatsApp persistence dropped after retries (${context})`,
							lastError instanceof Error ? lastError.stack : String(lastError),
						);
					}
				} finally {
					this.activePersists -= 1;
				}
			})
			.catch(error =>
				this.logger.error(
					`WhatsApp persistence queue failed (${context})`,
					error instanceof Error ? error.stack : String(error),
				),
			);
	}

	private scheduleBootstrap(accountId: string) {
		if (this.bootstrapping.has(accountId)) return;
		this.bootstrapping.add(accountId);
		// Hard unlock so a hung provider call cannot leave sync stuck forever.
		const unlockTimer = setTimeout(() => {
			if (this.bootstrapping.has(accountId)) {
				this.bootstrapping.delete(accountId);
				this.gateway.emitAccountEvent(accountId, 'sync_failed', {
					message: 'Inbox sync timed out. Click Sync to retry.',
				});
			}
		}, 90000);
		const run = (attempt: number) => {
			void this.bootstrapAccount(accountId)
				.then(result => {
					clearTimeout(unlockTimer);
					this.bootstrapping.delete(accountId);
					this.gateway.emitAccountEvent(accountId, 'sync_completed', {
						...result,
						progress: 100,
					});
				})
				.catch(error => {
					if (attempt < 2) {
						this.gateway.emitAccountEvent(accountId, 'sync_progress', {
							accountId,
							progress: 20,
							stage: 'retry',
							attempt,
						});
						setTimeout(() => run(attempt + 1), 2500 * attempt);
						return;
					}
					clearTimeout(unlockTimer);
					this.bootstrapping.delete(accountId);
					this.gateway.emitAccountEvent(accountId, 'sync_failed', {
						message: error instanceof Error ? error.message : String(error),
					});
				});
		};
		setTimeout(() => run(1), 2000);
	}

	async bootstrapAccount(accountId: string, limit = 40) {
		const provider = this.requireProvider(accountId);
		this.gateway.emitAccountEvent(accountId, 'sync_started', {
			accountId,
			progress: 10,
			stage: 'starting',
		});
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 25,
			stage: 'chats',
		});
		// Inbox order repair only — skip heavy contact sync during bootstrap.
		const chats =
			provider.capabilities.history
				? await this.syncChatsInternal(accountId, provider, limit, {
						syncGroupParticipants: false,
					})
				: { supported: false, count: 0 };
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 90,
			stage: 'chats_done',
			chats,
		});
		return { contacts: { supported: false, skipped: true }, chats, progress: 100 };
	}

	private async ensureConversation(
		accountId: string,
		chatId: string,
		options: { title?: string | null; phone?: string | null } = {},
	) {
		const hydrate = async (id: string) =>
			this.conversationRepo.findOneOrFail({
				where: { id },
				relations: ['contact', 'group', 'group.participants', 'assignedUser'],
			});

		const existing = await this.conversationRepo.findOne({
			where: { accountId, providerChatId: chatId },
			relations: ['contact', 'group', 'group.participants', 'assignedUser'],
		});
		if (existing) {
			if (
				existing.contact &&
				options.title &&
				(!existing.contact.name || existing.contact.name === existing.contact.phoneNumber)
			) {
				existing.contact.name = options.title;
				await this.contactRepo.save(existing.contact);
			}
			return existing;
		}

		try {
			if (chatId.endsWith('@g.us')) {
				let group = await this.groupRepo.findOne({ where: { accountId, waId: chatId } });
				if (!group) {
					try {
						group = await this.groupRepo.save(
							this.groupRepo.create({
								accountId,
								waId: chatId,
								subject: options.title || chatId,
								description: null,
								ownerWaId: null,
								participantCount: 0,
								metadataSyncedAt: null,
							}),
						);
					} catch (error: any) {
						if (error?.code !== '23505') throw error;
						group = await this.groupRepo.findOneByOrFail({ accountId, waId: chatId });
					}
				}
				const conversation = await this.conversationRepo.save(
					this.conversationRepo.create({
						accountId,
						providerChatId: chatId,
						type: WhatsAppConversationType.GROUP,
						groupId: group.id,
						assignedUserId: null,
					}),
				);
				return hydrate(conversation.id);
			}

			let contact = await this.contactRepo.findOne({ where: { accountId, waId: chatId } });
			if (!contact) {
				try {
					contact = await this.contactRepo.save(
						this.contactRepo.create({
							accountId,
							waId: chatId,
							phoneNumber: options.phone || phoneFromWaId(chatId),
							name: options.title || null,
							avatarUrl: null,
							isBusiness: false,
						}),
					);
				} catch (error: any) {
					if (error?.code !== '23505') throw error;
					contact = await this.contactRepo.findOneByOrFail({ accountId, waId: chatId });
				}
			}
			const conversation = await this.conversationRepo.save(
				this.conversationRepo.create({
					accountId,
					providerChatId: chatId,
					type: WhatsAppConversationType.DIRECT,
					contactId: contact.id,
					assignedUserId: null,
				}),
			);
			return hydrate(conversation.id);
		} catch (error: any) {
			if (error?.code === '23505') {
				const conversation = await this.conversationRepo.findOne({
					where: { accountId, providerChatId: chatId },
				});
				if (conversation) return hydrate(conversation.id);
			}
			throw error;
		}
	}

	async persistMessage(
		accountId: string,
		normalized: NormalizedWhatsAppMessage,
		senderUserId?: string | null,
		notifyAssignedUser = false,
		options: { emitEvents?: boolean } = {},
	) {
		const emitEvents = options.emitEvents !== false;
		if (!normalized.providerMessageId || !normalized.chatId) {
			throw new BadRequestException('Provider message does not have stable identifiers');
		}
		const account = await this.accountRepo.findOneByOrFail({ id: accountId });
		const conversation = await this.ensureConversation(accountId, normalized.chatId, {
			title: normalized.contactName,
		});
		const existing = await this.messageRepo.findOne({
			where: { accountId, providerMessageId: normalized.providerMessageId },
			relations: ['attachments', 'senderUser'],
		});
		if (existing) return existing;

		let saved: WhatsAppMessage;
		try {
			saved = await this.messageRepo.save(
				this.messageRepo.create({
					accountId,
					conversationId: conversation.id,
					providerMessageId: normalized.providerMessageId,
					providerName: account.providerName,
					direction: normalized.fromMe
						? WhatsAppMessageDirection.OUTBOUND
						: WhatsAppMessageDirection.INBOUND,
					senderWaId: normalized.senderWaId || null,
					senderUserId: senderUserId || null,
					type: normalized.type || 'text',
					text: normalized.text || null,
					status: normalized.fromMe
						? WhatsAppMessageStatus.SENT
						: WhatsAppMessageStatus.DELIVERED,
					statusUpdatedAt: new Date(),
					quotedProviderMessageId: normalized.quotedProviderMessageId || null,
					providerTimestamp:
						normalized.timestampReliable !== false &&
						normalized.timestamp?.getTime?.() > 0
							? normalized.timestamp
							: conversation.lastMessageAt || normalized.timestamp,
					raw: safeProviderMetadata(normalized.raw),
				}),
			);
		} catch (error: any) {
			if (error?.code === '23505') {
				return this.messageRepo.findOneOrFail({
					where: { accountId, providerMessageId: normalized.providerMessageId },
					relations: ['attachments', 'senderUser'],
				});
			}
			throw error;
		}

		if (normalized.attachments?.length) {
			await this.attachmentRepo.save(
				normalized.attachments.map(item =>
					this.attachmentRepo.create({
						messageId: saved.id,
						type: item.type,
						mimeType: item.mimeType || null,
						fileName: item.fileName || null,
						fileSizeBytes: item.fileSizeBytes ? String(item.fileSizeBytes) : null,
						providerMediaId: item.providerMediaId || normalized.providerMessageId,
						storagePath: null,
						downloadStatus: 'pending',
					}),
				),
			);
		}

		const nextLastMessageAt =
			normalized.timestampReliable === false || this.bootstrapping.has(accountId)
				? null
				: whatsAppTimestampToDate(normalized.timestamp);
		const previousLastMessageAt = conversation.lastMessageAt
			? new Date(conversation.lastMessageAt).getTime()
			: 0;
		const shouldBumpLastMessage =
			nextLastMessageAt != null && nextLastMessageAt.getTime() >= previousLastMessageAt;
		// Only live inbound messages raise unread. Outbound + history sync must not.
		const shouldCountUnread =
			emitEvents && !normalized.fromMe && !this.bootstrapping.has(accountId);
		if (shouldCountUnread) {
			await this.conversationRepo.increment({ id: conversation.id }, 'unreadCount', 1);
		}
		if (shouldBumpLastMessage) {
			await this.conversationRepo.update(conversation.id, {
				lastMessageAt: nextLastMessageAt,
			} as any);
		}
		const unreadRow = await this.conversationRepo.findOne({
			where: { id: conversation.id },
			select: ['id', 'unreadCount'],
		});
		const nextUnreadCount = unreadRow?.unreadCount ?? conversation.unreadCount;
		const hydrated = await this.messageRepo.findOneOrFail({
			where: { id: saved.id },
			relations: ['attachments', 'senderUser'],
		});
		if (emitEvents) {
			this.gateway.emitConversationEvent(conversation.id, 'message', hydrated);
			this.scheduleConversationUpdated(accountId, {
				conversationId: conversation.id,
				assignedUserId: conversation.assignedUserId,
				lastMessageAt: hydrated.providerTimestamp,
				unreadCount: nextUnreadCount,
				preview: {
					id: hydrated.id,
					type: hydrated.type,
					direction: hydrated.direction,
					status: hydrated.status,
					hasAttachments: Boolean(hydrated.attachments?.length),
				},
			});
		}
		if (
			emitEvents &&
			notifyAssignedUser &&
			!normalized.fromMe &&
			!this.bootstrapping.has(accountId)
		) {
			const recipientIds = await this.access.notificationRecipientIds(
				accountId,
				conversation.assignedUserId,
			);
			const title = normalized.contactName || 'New WhatsApp message';
			const message =
				normalized.text?.trim().slice(0, 240) ||
				`New ${normalized.type || 'message'}`;
			await Promise.all(
				recipientIds.map(userId =>
					this.notifications.create({
						type: NotificationType.WHATSAPP_MESSAGE,
						title,
						message,
						data: {
							accountId,
							conversationId: conversation.id,
							messageId: hydrated.id,
							type: 'whatsapp_message',
						},
						audience: NotificationAudience.USER,
						userId,
					}),
				),
			);
		}
		return hydrated;
	}

	private scheduleConversationUpdated(accountId: string, payload: Record<string, unknown>) {
		const timerKey = `${accountId}:${String(payload.conversationId || 'unknown')}`;
		const existing = this.conversationUpdateTimers.get(timerKey);
		if (existing) clearTimeout(existing);
		this.conversationUpdateTimers.set(
			timerKey,
			setTimeout(() => {
				this.conversationUpdateTimers.delete(timerKey);
				this.gateway.emitAccountEvent(accountId, 'conversation_updated', payload);
			}, 1200),
		);
	}

	async syncContacts(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.requireProvider(accountId);
		return this.syncContactsInternal(accountId, provider);
	}

	private async syncContactsInternal(accountId: string, provider: WhatsAppProvider) {
		if (!provider.capabilities.contacts) return { supported: false, count: 0 };
		let contacts: any[] = [];
		try {
			contacts = (await provider.getContacts()) || [];
		} catch {
			return { supported: true, count: 0, failed: true };
		}
		let count = 0;
		for (const item of contacts) {
			const id = waId(item);
			if (!id || id.endsWith('@g.us') || id === 'status@broadcast') continue;
			await this.contactRepo.upsert(
				{
					accountId,
					waId: id,
					phoneNumber: item?.id?.user || phoneFromWaId(id),
					name: item?.name || item?.pushname || item?.formattedName || null,
					avatarUrl: item?.profilePicThumbObj?.eurl || null,
					isBusiness: Boolean(item?.isBusiness),
				},
				['accountId', 'waId'],
			);
			count += 1;
		}
		return { supported: true, count };
	}

	async syncChats(user: User, accountId: string, limit = 100) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.requireProvider(accountId);
		return this.syncChatsInternal(accountId, provider, limit, {
			syncGroupParticipants: false,
		});
	}

	private async syncChatsInternal(
		accountId: string,
		provider: WhatsAppProvider,
		limit = 40,
		options: { syncGroupParticipants?: boolean } = {},
	) {
		if (!provider.capabilities.history) return { supported: false, count: 0 };
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 30,
			stage: 'fetching_chats',
		});
		const chats = await provider.getChats(Math.min(limit, 40));
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 40,
			stage: 'saving_chats',
			fetched: Array.isArray(chats) ? chats.length : 0,
		});
		const list = (Array.isArray(chats) ? chats : [])
			.map(chat => {
				const id = waId(chat) || waId(chat?.id) || waId(chat?.chatId);
				const activityMs =
					whatsAppTimestampToMs(
						chat?.t ??
							chat?.timestamp ??
							chat?.lastMessage?.t ??
							chat?.lastMessage?.timestamp ??
							chat?.msgs?.last?.()?.t,
					) || 0;
				return { chat, id, activityMs };
			})
			.filter(item => item.id && !item.id.includes('status@') && !item.id.includes('@broadcast'))
			.sort((a, b) => b.activityMs - a.activityMs);
		let count = 0;
		const total = list.length || 1;
		for (const { chat, id, activityMs } of list) {
			const title =
				chat?.name ||
				chat?.contact?.name ||
				chat?.contact?.pushname ||
				chat?.contact?.formattedName ||
				chat?.formattedTitle ||
				chat?.formattedName ||
				null;
			const phone =
				chat?.contact?.id?.user ||
				phoneFromWaId(id) ||
				phoneFromWaId(waId(chat?.contact)) ||
				null;
			const conversation = await this.ensureConversation(accountId, id, {
				title,
				phone,
			});
			if (conversation.contact) {
				const nextName = title || conversation.contact.name;
				const nextPhone = phone || conversation.contact.phoneNumber;
				if (
					nextName !== conversation.contact.name ||
					nextPhone !== conversation.contact.phoneNumber
				) {
					await this.contactRepo.update(conversation.contact.id, {
						name: nextName || null,
						phoneNumber: nextPhone || null,
					});
				}
			}
			const lastMessageAt = activityMs ? new Date(activityMs) : null;
			if (lastMessageAt) {
				// Always trust provider chat activity time on inbox sync so "now"/unreliable
				// message fallbacks cannot keep months-old chats pinned as recent minutes.
				await this.conversationRepo.update(conversation.id, { lastMessageAt });
			}
			if (
				options.syncGroupParticipants &&
				id.endsWith('@g.us') &&
				provider.capabilities.groupParticipants
			) {
				await this.syncGroupMetadata(provider, accountId, id);
			}
			count += 1;
			if (count % 3 === 0 || count === list.length) {
				this.gateway.emitAccountEvent(accountId, 'sync_progress', {
					accountId,
					progress: 40 + Math.round((count / total) * 45),
					stage: 'chats',
					synced: count,
					total: list.length,
				});
			}
		}
		return { supported: true, count };
	}

	private async syncGroupMetadata(
		provider: WhatsAppProvider,
		accountId: string,
		groupWaId: string,
	) {
		const group = await this.groupRepo.findOne({ where: { accountId, waId: groupWaId } });
		if (!group) return;
		const participants = await provider.getGroupParticipants(groupWaId);
		await this.participantRepo.manager.transaction(async manager => {
			await manager.delete(WhatsAppGroupParticipant, { groupId: group.id });
			if (participants?.length) {
				await manager.save(
					WhatsAppGroupParticipant,
					participants.map((item: any) =>
						manager.create(WhatsAppGroupParticipant, {
							groupId: group.id,
							waId: waId(item),
							displayName: item?.name || item?.pushname || null,
							isAdmin: Boolean(item?.isAdmin || item?.isSuperAdmin),
							isSuperAdmin: Boolean(item?.isSuperAdmin),
						}),
					),
				);
			}
			await manager.update(WhatsAppGroup, group.id, {
				participantCount: participants?.length || 0,
				metadataSyncedAt: new Date(),
			});
		});
	}

	async listConversations(user: User, accountId: string, page = 1, limit = 50) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const pageNumber = Math.max(Number(page) || 1, 1);
		const query = this.conversationRepo
			.createQueryBuilder('conversation')
			.leftJoinAndSelect('conversation.contact', 'contact')
			.leftJoinAndSelect('conversation.group', 'group')
			.leftJoinAndSelect('conversation.assignedUser', 'assignedUser')
			.where('conversation.accountId = :accountId', { accountId });
		if (!canSeeAll) {
			query.andWhere('conversation.assignedUserId = :userId', { userId: user.id });
		}
		const [items, total] = await query
			.orderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
			.addOrderBy('conversation.created_at', 'DESC')
			.take(take)
			.skip((pageNumber - 1) * take)
			.getManyAndCount();
		return {
			items,
			total,
			page: pageNumber,
			limit: take,
			scope: canSeeAll ? 'all' : 'assigned',
		};
	}

	async assertConversationVisible(user: User, conversationId: string) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
			relations: ['contact', 'group', 'group.participants', 'assignedUser'],
		});
		if (!conversation) throw new NotFoundException('WhatsApp conversation not found');
		const accountAccess = await this.access.getAccountAccess(user, conversation.accountId);
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		if (
			!accountAccess.canView ||
			(!canSeeAll && conversation.assignedUserId !== user.id)
		) {
			throw new ForbiddenException('WhatsApp conversation access denied');
		}
		return { conversation, accountAccess, canSeeAll };
	}

	async listMessages(
		user: User,
		conversationId: string,
		before?: string,
		limit = 30,
	) {
		await this.assertConversationVisible(user, conversationId);
		const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
		const query = this.messageRepo
			.createQueryBuilder('message')
			.leftJoinAndSelect('message.attachments', 'attachments')
			.leftJoinAndSelect('message.senderUser', 'senderUser')
			.where('message.conversationId = :conversationId', { conversationId });
		if (before) {
			const cursor = await this.messageRepo.findOne({
				where: { id: before, conversationId },
			});
			if (cursor?.providerTimestamp) {
				query.andWhere(
					'(message.providerTimestamp < :timestamp OR (message.providerTimestamp = :timestamp AND message.id < :cursorId))',
					{
						timestamp: cursor.providerTimestamp,
						cursorId: cursor.id,
					},
				);
			}
		}
		const items = await query
			.orderBy('message.providerTimestamp', 'DESC')
			.addOrderBy('message.created_at', 'DESC')
			.take(take)
			.getMany();
		for (const message of items) {
			const duration = Number(
				message.raw?.duration ?? message.raw?.mediaData?.duration ?? 0,
			);
			if (!(Number.isFinite(duration) && duration > 0)) continue;
			for (const attachment of message.attachments || []) {
				const type = String(attachment.type || '').toLowerCase();
				if (type !== 'audio' && type !== 'ptt' && type !== 'voice') continue;
				if (/voice-\d/i.test(String(attachment.fileName || ''))) continue;
				const ext =
					String(attachment.mimeType || '').includes('webm')
						? '.webm'
						: String(attachment.mimeType || '').includes('mpeg')
							? '.mp3'
							: '.ogg';
				attachment.fileName = `voice-${Math.round(duration)}s${ext}`;
			}
		}
		return items.reverse();
	}

	async syncConversation(
		user: User,
		conversationId: string,
		mode: 'latest' | 'older',
		limit = 30,
	) {
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send/sync access denied');
		const provider = this.requireProvider(conversation.accountId);
		if (!provider.capabilities.history) {
			return { supported: false, items: [], hasMore: false };
		}
		const [latestLocal, oldestBeforeSync, localCount] = await Promise.all([
			mode === 'latest'
				? this.messageRepo.findOne({
						where: { conversationId },
						order: { providerTimestamp: 'DESC' },
					})
				: Promise.resolve(null),
			this.messageRepo.findOne({
				where: { conversationId },
				order: { providerTimestamp: 'ASC' },
			}),
			this.messageRepo.count({ where: { conversationId } }),
		]);
		const requestedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
		const messages = await provider.getMessages(conversation.providerChatId, {
			limit: requestedLimit,
			before: mode === 'older' ? conversation.oldestProviderCursor || undefined : undefined,
			// A partial local cache (for example 1–3 messages) must be backfilled
			// with the provider's latest page, not only messages newer than the last row.
			after:
				mode === 'latest' && localCount >= requestedLimit
					? latestLocal?.providerMessageId
					: undefined,
		});
		for (const item of messages) {
			await this.persistMessage(conversation.accountId, item, null, false, {
				emitEvents: false,
			});
		}
		const oldestStored = await this.messageRepo.findOne({
			where: { conversationId },
			order: { providerTimestamp: 'ASC' },
		});
		const sortedProvider = [...(messages || [])].sort((a: any, b: any) => {
			const aTime = new Date(a?.providerTimestamp || 0).getTime();
			const bTime = new Date(b?.providerTimestamp || 0).getTime();
			if (aTime !== bTime) return aTime - bTime;
			return String(a?.providerMessageId || '').localeCompare(
				String(b?.providerMessageId || ''),
			);
		});
		const oldestFromBatch = sortedProvider[0]?.providerMessageId || null;
		// Latest sync must never move the oldest cursor forward; only older sync
		// (or first hydration) may establish how far back we reached.
		const oldest =
			mode === 'older'
				? oldestFromBatch ||
					conversation.oldestProviderCursor ||
					oldestStored?.providerMessageId ||
					null
				: conversation.oldestProviderCursor ||
					oldestStored?.providerMessageId ||
					oldestFromBatch ||
					null;
		const hasMoreProviderHistory =
			mode === 'older'
				? messages.length >= requestedLimit
				: localCount < requestedLimit
					? messages.length >= requestedLimit
					: conversation.hasMoreProviderHistory;
		await this.conversationRepo.update(conversation.id, {
			lastProviderSyncAt: new Date(),
			oldestProviderCursor: oldest,
			hasMoreProviderHistory,
		});
		return {
			supported: true,
			items: await this.listMessages(
				user,
				conversationId,
				mode === 'older' ? oldestBeforeSync?.id : undefined,
				requestedLimit,
			),
			hasMore: hasMoreProviderHistory,
		};
	}

	private async markReadAfterReply(
		conversation: WhatsAppConversation,
		account: WhatsAppAccount,
		provider: WhatsAppProvider,
		userId: string,
	) {
		const privacy = getWhatsAppPrivacySettings(account);
		if (privacy.readReceiptMode !== 'on_reply') return;

		try {
			await provider.markChatRead(conversation.providerChatId);
			await this.conversationRepo.update(conversation.id, { unreadCount: 0 });
			this.gateway.emitAccountEvent(conversation.accountId, 'conversation_read', {
				conversationId: conversation.id,
				userId,
			});
		} catch (error) {
			// The outgoing message already succeeded. A receipt failure must not make
			// the frontend retry and accidentally send the message twice.
			this.logger.warn(
				`Could not mark conversation ${conversation.id} read after reply: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async markConversationRead(
		user: User,
		conversationId: string,
		manualReceiptRequested = false,
	) {
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		const privacy = getWhatsAppPrivacySettings(accountAccess.account);
		const shouldSendReceipt =
			accountAccess.canUse &&
			(privacy.readReceiptMode === 'on_open' ||
				(privacy.readReceiptMode === 'manual' && manualReceiptRequested));
		let providerReceiptSent = false;
		if (shouldSendReceipt) {
			const provider = this.providers.getProvider(conversation.accountId);
			if (provider?.getState() === 'connected') {
				await provider.markChatRead(conversation.providerChatId);
				providerReceiptSent = true;
			}
		}
		await this.conversationRepo.update(conversationId, { unreadCount: 0 });
		this.gateway.emitAccountEvent(conversation.accountId, 'conversation_read', {
			conversationId,
			userId: user.id,
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.conversation.read',
			targetType: 'WhatsAppConversation',
			targetId: conversationId,
			metadata: {
				providerReceiptSent,
				readReceiptMode: privacy.readReceiptMode,
				manualReceiptRequested,
			},
		});
		return {
			ok: true,
			providerReceiptSent,
			readReceiptMode: privacy.readReceiptMode,
		};
	}

	async listConversationNotes(user: User, conversationId: string) {
		await this.assertConversationVisible(user, conversationId);
		return this.noteRepo.find({
			where: { conversationId },
			relations: ['author'],
			order: { created_at: 'ASC' },
			take: 200,
		});
	}

	async createConversationNote(user: User, conversationId: string, text: string) {
		await this.assertConversationVisible(user, conversationId);
		const trimmed = String(text || '').trim();
		if (!trimmed) throw new BadRequestException('Note text is required');
		if (trimmed.length > 2000) {
			throw new BadRequestException('Note text must be at most 2000 characters');
		}
		const note = await this.noteRepo.save(
			this.noteRepo.create({
				conversationId,
				authorUserId: user.id,
				text: trimmed,
			}),
		);
		return this.noteRepo.findOne({
			where: { id: note.id },
			relations: ['author'],
		});
	}

	async sendText(
		user: User,
		conversationId: string,
		text: string,
		quotedProviderMessageId?: string,
		clientMessageId?: string,
	) {
		if (clientMessageId) {
			return this.runIdempotentSend(user.id, conversationId, clientMessageId, () =>
				this.sendText(user, conversationId, text, quotedProviderMessageId),
			);
		}
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		const provider = this.requireProvider(conversation.accountId);
		const result = await provider.sendText(
			conversation.providerChatId,
			text,
			quotedProviderMessageId,
		);
		const id =
			providerMessageId(result) ||
			`local_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		if (!providerMessageId(result)) {
			this.logger.warn(
				`sendText returned without a stable provider id for conversation ${conversationId}; persisting with local fallback id`,
			);
		}
		await this.markReadAfterReply(
			conversation,
			accountAccess.account,
			provider,
			user.id,
		);
		const saved = await this.persistMessage(
			conversation.accountId,
			{
				providerMessageId: id,
				chatId: conversation.providerChatId,
				fromMe: true,
				type: 'text',
				text,
				timestamp: new Date(),
				timestampReliable: true,
				quotedProviderMessageId: quotedProviderMessageId || null,
				raw: result,
			},
			user.id,
		);
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.message.sent',
			targetType: 'WhatsAppMessage',
			targetId: saved.id,
			metadata: { conversationId },
		});
		return { ok: true, message: saved, providerResult: { id } };
	}

	async sendMedia(
		user: User,
		conversationId: string,
		input: {
			type: string;
			fileId: string;
			caption?: string;
			quotedProviderMessageId?: string;
			clientMessageId?: string;
		},
	) {
		if (input.clientMessageId) {
			const { clientMessageId, ...singleSendInput } = input;
			return this.runIdempotentSend(user.id, conversationId, clientMessageId, () =>
				this.sendMedia(user, conversationId, singleSendInput),
			);
		}
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		const root = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT ||
				path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const absolutePath = path.resolve(root, input.fileId);
		const allowedUploadRoot = path.join(
			root,
			'outgoing',
			conversation.accountId,
			user.id,
		);
		if (!absolutePath.startsWith(`${allowedUploadRoot}${path.sep}`)) {
			throw new BadRequestException('Invalid WhatsApp media identifier');
		}
		await fs.access(absolutePath);
		const provider = this.requireProvider(conversation.accountId);
		const mimeGuess = absolutePath.toLowerCase().endsWith('.ogg')
			? 'audio/ogg; codecs=opus'
			: absolutePath.toLowerCase().endsWith('.webm')
				? 'audio/webm; codecs=opus'
				: absolutePath.toLowerCase().endsWith('.mp3')
					? 'audio/mpeg'
					: absolutePath.toLowerCase().endsWith('.m4a')
						? 'audio/mp4'
						: null;
		const result = await provider.sendMedia(conversation.providerChatId, absolutePath, {
			caption: input.caption,
			fileName: path.basename(absolutePath),
			isVoice: input.type === 'voice',
			mimeType: mimeGuess,
			quotedProviderMessageId: input.quotedProviderMessageId,
		});
		const id =
			providerMessageId(result) ||
			`local_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		if (!providerMessageId(result)) {
			this.logger.warn(
				`sendMedia returned without a stable provider id for conversation ${conversationId}; persisting with local fallback id`,
			);
		}
		await this.markReadAfterReply(
			conversation,
			accountAccess.account,
			provider,
			user.id,
		);
		const stat = await fs.stat(absolutePath);
		const attachmentType = input.type === 'voice' ? 'audio' : input.type;
		const saved = await this.persistMessage(
			conversation.accountId,
			{
				providerMessageId: id,
				chatId: conversation.providerChatId,
				fromMe: true,
				type: attachmentType,
				text: input.caption || null,
				timestamp: new Date(),
				timestampReliable: true,
				quotedProviderMessageId: input.quotedProviderMessageId || null,
				attachments: [
					{
						type: attachmentType,
						mimeType: mimeGuess,
						fileName: path.basename(absolutePath),
						fileSizeBytes: stat.size,
						providerMediaId: id,
					},
				],
				raw: result,
			},
			user.id,
		);
		const attachment = saved.attachments?.[0];
		if (attachment) {
			attachment.storagePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
			attachment.downloadStatus = 'downloaded';
			await this.attachmentRepo.save(attachment);
		}
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.message.media_sent',
			targetType: 'WhatsAppMessage',
			targetId: saved.id,
			metadata: { conversationId, type: input.type },
		});
		return { ok: true, message: saved, providerResult: { id } };
	}

	async listGroups(user: User, accountId: string) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		const groups = await this.groupRepo.find({
			where: { accountId },
			relations: ['participants'],
			order: { subject: 'ASC' },
		});
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const conversations = groups.length
			? await this.conversationRepo
					.createQueryBuilder('conversation')
					.where('conversation.accountId = :accountId', { accountId })
					.andWhere('conversation.groupId IN (:...groupIds)', {
						groupIds: groups.map(group => group.id),
					})
					.andWhere(
						canSeeAll ? '1 = 1' : 'conversation.assignedUserId = :userId',
						canSeeAll ? {} : { userId: user.id },
					)
					.getMany()
			: [];
		const conversationByGroup = new Map(
			conversations.map(conversation => [conversation.groupId, conversation.id]),
		);
		return groups.map(group => ({
			...group,
			conversationId: conversationByGroup.get(group.id) || null,
		}));
	}

	async getGroupDetails(
		user: User,
		accountId: string,
		groupId: string,
		refresh = false,
	) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		let group = await this.groupRepo.findOne({
			where: { id: groupId, accountId },
			relations: ['participants'],
		});
		if (!group) throw new NotFoundException('WhatsApp group not found');

		if (refresh) {
			const provider = this.requireProvider(accountId);
			if (provider.capabilities.groupParticipants) {
				try {
					await this.syncGroupMetadata(provider, accountId, group.waId);
				} catch {
					// Return stored details when WhatsApp cannot refresh participants.
				}
			}
			try {
				const providerGroups = (await provider.getGroups()) || [];
				const providerGroup = providerGroups.find(
					(item: any) => waId(item) === group!.waId || waId(item?.id) === group!.waId,
				);
				if (providerGroup) {
					await this.groupRepo.update(group.id, {
						subject:
							providerGroup?.name ||
							providerGroup?.subject ||
							providerGroup?.formattedTitle ||
							group.subject,
						description:
							providerGroup?.groupMetadata?.desc ||
							providerGroup?.description ||
							group.description,
						ownerWaId:
							waId(providerGroup?.groupMetadata?.owner) ||
							waId(providerGroup?.owner) ||
							group.ownerWaId,
					});
				}
			} catch {
				// Participant details are still useful when full group metadata is unavailable.
			}
			group = await this.groupRepo.findOneOrFail({
				where: { id: groupId, accountId },
				relations: ['participants'],
			});
		}

		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const conversationQuery = this.conversationRepo
			.createQueryBuilder('conversation')
			.where('conversation.accountId = :accountId', { accountId })
			.andWhere('conversation.groupId = :groupId', { groupId });
		if (!canSeeAll) {
			conversationQuery.andWhere('conversation.assignedUserId = :userId', {
				userId: user.id,
			});
		}
		const conversation = await conversationQuery.getOne();
		return { ...group, conversationId: conversation?.id || null };
	}

	async downloadAttachment(user: User, attachmentId: string) {
		const attachment = await this.attachmentRepo.findOne({
			where: { id: attachmentId },
			relations: ['message'],
		});
		if (!attachment) throw new NotFoundException('WhatsApp attachment not found');
		await this.assertConversationVisible(user, attachment.message.conversationId);
		if (attachment.storagePath && attachment.downloadStatus === 'downloaded') {
			return {
				ok: true,
				path: attachment.storagePath,
				url: `/api/v1/whatsapp/attachments/${attachment.id}/content`,
				cached: true,
				mimeType: attachment.mimeType,
				type: attachment.type,
			};
		}
		const provider = this.requireProvider(attachment.message.accountId);
		if (!provider.capabilities.mediaDownload) {
			return { ok: false, supported: false };
		}
		attachment.downloadStatus = 'downloading';
		await this.attachmentRepo.save(attachment);
		try {
			const mediaId = attachment.providerMediaId || attachment.message.providerMessageId;
			if (!mediaId) throw new Error('Attachment has no provider media id');
			let data: any;
			try {
				data = await provider.downloadMedia(mediaId);
			} catch (error: any) {
				const detail = String(error?.message || error || '');
				throw new Error(
					detail && detail !== 'Object'
						? detail
						: 'Media is unavailable from WhatsApp right now',
				);
			}
			const raw = String(data?.data || data || '').replace(/^data:[^;]+;base64,/, '');
			const buffer = Buffer.from(raw, 'base64');
			if (!buffer.length) throw new Error('Provider returned empty media');
			const root = path.resolve(
				process.env.WHATSAPP_MEDIA_ROOT ||
					path.join(process.cwd(), 'storage', 'whatsapp-media'),
			);
			const accountFolder = path.join(root, attachment.message.accountId);
			await fs.mkdir(accountFolder, { recursive: true });
			const safeName = `${attachment.id}-${path
				.basename(attachment.fileName || 'attachment')
				.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
			const absolutePath = path.resolve(accountFolder, safeName);
			if (!absolutePath.startsWith(`${accountFolder}${path.sep}`)) {
				throw new Error('Invalid media storage path');
			}
			await fs.writeFile(absolutePath, buffer);
			attachment.storagePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
			attachment.fileSizeBytes = String(buffer.length);
			attachment.downloadStatus = 'downloaded';
			await this.attachmentRepo.save(attachment);
			return {
				ok: true,
				path: attachment.storagePath,
				url: `/api/v1/whatsapp/attachments/${attachment.id}/content`,
				cached: false,
				mimeType: attachment.mimeType,
				type: attachment.type,
			};
		} catch (error: any) {
			attachment.downloadStatus = 'failed';
			await this.attachmentRepo.save(attachment);
			const detail = String(error?.message || error || '');
			throw new BadRequestException(
				detail && detail !== 'Object'
					? detail
					: 'WhatsApp media is not available',
			);
		}
	}

	async resolveAttachmentFile(user: User, attachmentId: string) {
		const downloaded = await this.downloadAttachment(user, attachmentId);
		if (!downloaded?.ok || !downloaded.path) {
			throw new BadRequestException('WhatsApp media is not available');
		}
		const absolutePath = path.resolve(process.cwd(), downloaded.path.replace(/^\/+/, ''));
		const privateRoot = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT ||
				path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const legacyRoot = path.resolve(
			path.join(process.cwd(), 'uploads', 'whatsapp-media'),
		);
		if (
			![privateRoot, legacyRoot].some(
				root => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`),
			)
		) {
			throw new BadRequestException('Invalid WhatsApp media storage path');
		}
		await fs.access(absolutePath);
		const attachment = await this.attachmentRepo.findOne({ where: { id: attachmentId } });
		return {
			absolutePath,
			mimeType: downloaded.mimeType || attachment?.mimeType || 'application/octet-stream',
			fileName: attachment?.fileName || path.basename(absolutePath),
		};
	}
}
