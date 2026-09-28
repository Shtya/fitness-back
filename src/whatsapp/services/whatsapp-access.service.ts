import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../../entities/global.entity';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppConversation,
} from '../entities/whatsapp.entity';
import {
	getWhatsAppNotificationPreferences,
	userAllowsWhatsAppNotifications,
	WhatsAppNotificationPreferences,
} from '../utils/whatsapp-notification-preferences';

export type WhatsAppAccountPermission =
	| 'canView'
	| 'canUse'
	| 'canManage'
	| 'canAssign'
	| 'canTransfer';

const ACCESS_CACHE_TTL_MS = 10_000;
const ACCESS_CACHE_MAX = 2000;

type CacheEntry<T> = { row: T; at: number };

function cloneRow<T extends object>(row: T): T;
function cloneRow<T extends object>(row: T | null): T | null;
function cloneRow<T extends object>(row: T | null): T | null {
	return row ? Object.assign(Object.create(Object.getPrototypeOf(row)), row) : null;
}

@Injectable()
export class WhatsAppAccessService {
	/**
	 * Every REST call, socket watch and unread poll resolves the same account + access
	 * rows. They are cached briefly and handed out as copies so a caller mutating its
	 * result cannot leak into the cache. `canManage` checks always read fresh rows,
	 * because those callers may `save()` the account they get back.
	 */
	private readonly accountCache = new Map<string, CacheEntry<WhatsAppAccount>>();
	private readonly accessCache = new Map<string, CacheEntry<WhatsAppAccountAccess | null>>();

	constructor(
		@InjectRepository(WhatsAppAccount)
		private readonly accountRepo: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly accessRepo: Repository<WhatsAppAccountAccess>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
	) {}

	private isEligibleStaff(user?: User | null) {
		return (
			user?.role === UserRole.ADMIN ||
			user?.role === UserRole.COACH ||
			user?.role === UserRole.SUPER_ADMIN
		);
	}

	private fullAccess(account: WhatsAppAccount, access?: WhatsAppAccountAccess | null) {
		return {
			account,
			canView: true,
			canUse: true,
			canManage: true,
			canAssign: true,
			canTransfer: true,
			notificationsEnabled:
				typeof access?.notificationsEnabled === 'boolean'
					? access.notificationsEnabled
					: true,
		};
	}

	canSeeAllConversations(
		user: User,
		access: {
			account: WhatsAppAccount;
			canManage?: boolean;
			canAssign?: boolean;
		},
	) {
		return (
			access.account.ownerAdminId === user.id ||
			Boolean(access.canManage) ||
			Boolean(access.canAssign)
		);
	}

	/** Drops cached account + access rows after any write that changes them. */
	invalidateAccount(accountId: string) {
		this.accountCache.delete(accountId);
		const prefix = `${accountId}:`;
		for (const key of this.accessCache.keys()) {
			if (key.startsWith(prefix)) this.accessCache.delete(key);
		}
	}

	/** Short-lived read-only snapshot for hot paths that only need stable account fields. */
	async getAccountSnapshot(accountId: string): Promise<WhatsAppAccount | null> {
		return cloneRow(await this.loadAccount(accountId, false));
	}

	private remember<T>(cache: Map<string, CacheEntry<T>>, key: string, row: T) {
		cache.delete(key);
		cache.set(key, { row, at: Date.now() });
		while (cache.size > ACCESS_CACHE_MAX) {
			cache.delete(cache.keys().next().value as string);
		}
	}

	private async loadAccount(accountId: string, fresh: boolean) {
		const cached = this.accountCache.get(accountId);
		if (!fresh && cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.row;
		const account = await this.accountRepo.findOne({ where: { id: accountId } });
		if (account) this.remember(this.accountCache, accountId, account);
		else this.accountCache.delete(accountId);
		return account;
	}

	private async loadAccess(accountId: string, userId: string, fresh: boolean) {
		const key = `${accountId}:${userId}`;
		const cached = this.accessCache.get(key);
		if (!fresh && cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.row;
		const access = await this.accessRepo.findOne({ where: { accountId, userId } });
		this.remember(this.accessCache, key, access || null);
		return access || null;
	}

	async getAccountAccess(user: User, accountId: string, options: { fresh?: boolean } = {}) {
		if (!user?.id) throw new ForbiddenException('WhatsApp user is not authenticated');
		const fresh = Boolean(options.fresh);
		const account = cloneRow(await this.loadAccount(accountId, fresh));
		if (!account) throw new NotFoundException('WhatsApp account not found');
		if (account.ownerAdminId === user.id) {
			const ownerAccess = cloneRow(await this.loadAccess(accountId, user.id, fresh));
			return this.fullAccess(account, ownerAccess);
		}
		if (!this.isEligibleStaff(user)) {
			throw new ForbiddenException('WhatsApp account access denied');
		}
		const access = cloneRow(await this.loadAccess(accountId, user.id, fresh));
		if (!access?.canView) throw new ForbiddenException('WhatsApp account access denied');
		return { account, ...access };
	}

	async listAccessibleAccounts(user: User) {
		return (await this.loadAccessibleAccounts(user)).accounts;
	}

	private async loadAccessibleAccounts(user: User) {
		if (!this.isEligibleStaff(user)) return { accounts: [], accessByAccountId: new Map() };

		const [owned, rows] = await Promise.all([
			this.accountRepo.find({
				where: { ownerAdminId: user.id },
				order: { created_at: 'DESC' },
			}),
			this.accessRepo.find({
				where: { userId: user.id, canView: true },
				relations: ['account'],
				order: { created_at: 'ASC' },
			}),
		]);
		const byId = new Map<string, WhatsAppAccount>();
		const accessByAccountId = new Map<string, WhatsAppAccountAccess>();
		for (const account of owned) byId.set(account.id, account);
		for (const row of rows) {
			if (!row.account) continue;
			byId.set(row.account.id, row.account);
			accessByAccountId.set(row.account.id, row);
		}
		const accounts = [...byId.values()].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);
		return { accounts, accessByAccountId };
	}

	/**
	 * Sum of unread messages across conversations the user can see, in one query.
	 * Visibility per account follows `canSeeAllConversations`: everything on accounts
	 * the user owns / manages / assigns, only their assigned chats elsewhere.
	 */
	async getUnreadTotal(user: User) {
		const { accounts, accessByAccountId } = await this.loadAccessibleAccounts(user);
		if (!accounts.length) {
			return { totalUnread: 0, unreadConversations: 0 };
		}
		const seeAllIds: string[] = [];
		const assignedOnlyIds: string[] = [];
		for (const account of accounts) {
			const access = accessByAccountId.get(account.id);
			const canSeeAll = this.canSeeAllConversations(user, {
				account,
				canManage: account.ownerAdminId === user.id || Boolean(access?.canManage),
				canAssign: account.ownerAdminId === user.id || Boolean(access?.canAssign),
			});
			(canSeeAll ? seeAllIds : assignedOnlyIds).push(account.id);
		}
		const visibility: string[] = [];
		if (seeAllIds.length) visibility.push('conversation.accountId IN (:...seeAllIds)');
		if (assignedOnlyIds.length) {
			visibility.push(
				'(conversation.accountId IN (:...assignedOnlyIds) AND conversation.assignedUserId = :userId)',
			);
		}
		const row = await this.conversationRepo
			.createQueryBuilder('conversation')
			.select('COALESCE(SUM(conversation.unreadCount), 0)', 'totalUnread')
			.addSelect(`COUNT(*) FILTER (WHERE conversation.unreadCount > 0)`, 'unreadConversations')
			.where(`(${visibility.join(' OR ')})`, { seeAllIds, assignedOnlyIds, userId: user.id })
			.andWhere('LOWER(conversation.providerChatId) NOT LIKE :broadcast', {
				broadcast: '%@broadcast%',
			})
			.andWhere('LOWER(conversation.providerChatId) NOT LIKE :status', {
				status: '%status@%',
			})
			.getRawOne();
		return {
			totalUnread: Number(row?.totalUnread) || 0,
			unreadConversations: Number(row?.unreadConversations) || 0,
		};
	}

	async assertAccountPermission(
		user: User,
		accountId: string,
		permission: WhatsAppAccountPermission = 'canView',
	) {
		const { account, ...access } = await this.getAccountAccess(user, accountId, {
			fresh: permission === 'canManage',
		});
		if (!access?.[permission]) {
			throw new ForbiddenException(`WhatsApp account permission denied: ${permission}`);
		}
		return account;
	}

	async assertConversationVisible(user: User, conversationId: string) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
			// Group participants are read through `participantRepo` where needed; loading
			// them here cost a join on every messages / watch / attachment request.
			relations: ['contact', 'group', 'assignedUser'],
		});
		if (!conversation) throw new NotFoundException('WhatsApp conversation not found');
		const accountAccess = await this.getAccountAccess(user, conversation.accountId);
		const canSeeAll = this.canSeeAllConversations(user, accountAccess);
		const isEmailMemoAi =
			String(conversation.providerChatId || '') === 'email-memo-ai@so7ba.internal';
		if (
			!accountAccess.canView ||
			(!canSeeAll && conversation.assignedUserId !== user.id && !isEmailMemoAi)
		) {
			throw new ForbiddenException('WhatsApp conversation access denied');
		}
		return { conversation, accountAccess, canSeeAll };
	}

	async notificationRecipientIds(accountId: string, assignedUserId?: string | null) {
		if (assignedUserId) return [assignedUserId];
		const [account, rows] = await Promise.all([
			this.accountRepo.findOne({ where: { id: accountId } }),
			this.accessRepo.find({ where: { accountId, canView: true } }),
		]);
		if (!account) return [];
		// Unassigned chats notify owner + staff who can use/manage/assign the inbox.
		return [
			...new Set([
				account.ownerAdminId,
				...rows
					.filter((row) => row.canManage || row.canAssign || row.canUse)
					.map((row) => row.userId)
					.filter(Boolean),
			]),
		];
	}

	async getNotificationPreferences(
		user: User,
		accountId: string,
	): Promise<WhatsAppNotificationPreferences> {
		const access = await this.getAccountAccess(user, accountId);
		return getWhatsAppNotificationPreferences(access);
	}

	async updateNotificationPreferences(
		user: User,
		accountId: string,
		settings: WhatsAppNotificationPreferences,
	): Promise<WhatsAppNotificationPreferences> {
		const access = await this.getAccountAccess(user, accountId);
		let row = await this.accessRepo.findOne({
			where: { accountId, userId: user.id },
		});
		if (!row) {
			row = this.accessRepo.create({
				accountId,
				userId: user.id,
				canView: Boolean(access.canView),
				canUse: Boolean(access.canUse),
				canManage: Boolean(access.canManage),
				canAssign: Boolean(access.canAssign),
				canTransfer: Boolean(access.canTransfer),
				notificationsEnabled: settings.notificationsEnabled,
			});
		} else {
			row.notificationsEnabled = settings.notificationsEnabled;
		}
		await this.accessRepo.save(row);
		this.invalidateAccount(accountId);
		return getWhatsAppNotificationPreferences(row);
	}

	async filterNotificationEnabledRecipients(
		accountId: string,
		userIds: string[],
	): Promise<string[]> {
		const ids = [
			...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
		];
		if (!ids.length) return [];
		const rows = await this.accessRepo.find({
			where: { accountId, userId: In(ids) },
		});
		const byUser = new Map(rows.map((row) => [String(row.userId), row]));
		return ids.filter((userId) => userAllowsWhatsAppNotifications(byUser.get(userId)));
	}

	async replaceAccountAccess(
		actor: User,
		accountId: string,
		items: Array<{
			userId: string;
			canView: boolean;
			canUse: boolean;
			canManage: boolean;
			canAssign: boolean;
			canTransfer: boolean;
		}>,
	) {
		const account = await this.assertAccountPermission(actor, accountId, 'canManage');
		const normalizedItems = items.filter((item) => item.userId !== account.ownerAdminId);
		normalizedItems.push({
			userId: account.ownerAdminId,
			canView: true,
			canUse: true,
			canManage: true,
			canAssign: true,
			canTransfer: true,
		});
		const userIds = [...new Set(normalizedItems.map((item) => item.userId))];
		const allowedRoles = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN];
		const users = userIds.length
			? await this.userRepo.find({
					where: { id: In(userIds), role: In(allowedRoles) },
				})
			: [];
		if (users.length !== userIds.length) {
			throw new NotFoundException('One or more eligible staff users do not exist');
		}
		if (actor.role !== UserRole.SUPER_ADMIN) {
			const outOfScope = users.filter(
				(candidate) =>
					candidate.id !== actor.id &&
					candidate.adminId !== actor.id &&
					candidate.coachId !== actor.id &&
					candidate.id !== account.ownerAdminId,
			);
			if (outOfScope.length) {
				throw new ForbiddenException(
					'Cannot grant WhatsApp access to users outside your staff scope',
				);
			}
		}

		await this.accessRepo.manager.transaction(async (manager) => {
			await manager.delete(WhatsAppAccountAccess, { accountId });
			if (normalizedItems.length) {
				await manager.save(
					WhatsAppAccountAccess,
					normalizedItems.map((item) =>
						manager.create(WhatsAppAccountAccess, {
							accountId,
							...item,
							canView:
								item.canView || item.canUse || item.canManage || item.canAssign || item.canTransfer,
						}),
					),
				);
			}
		});
		this.invalidateAccount(accountId);

		return this.accessRepo.find({
			where: { accountId },
			relations: ['user'],
			order: { created_at: 'ASC' },
		});
	}
}
