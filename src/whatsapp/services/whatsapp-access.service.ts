import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../../entities/global.entity';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppConversation,
} from '../entities/whatsapp.entity';

export type WhatsAppAccountPermission =
	| 'canView'
	| 'canUse'
	| 'canManage'
	| 'canAssign'
	| 'canTransfer';

@Injectable()
export class WhatsAppAccessService {
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

	private isSuperAdmin(user?: User | null) {
		return user?.role === UserRole.SUPER_ADMIN;
	}

	private isEligibleStaff(user?: User | null) {
		return (
			user?.role === UserRole.ADMIN ||
			user?.role === UserRole.COACH ||
			user?.role === UserRole.SUPER_ADMIN
		);
	}

	private fullAccess(account: WhatsAppAccount) {
		return {
			account,
			canView: true,
			canUse: true,
			canManage: true,
			canAssign: true,
			canTransfer: true,
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
			this.isSuperAdmin(user) ||
			access.account.ownerAdminId === user.id ||
			Boolean(access.canManage) ||
			Boolean(access.canAssign)
		);
	}

	async getAccountAccess(user: User, accountId: string) {
		if (!user?.id) throw new ForbiddenException('WhatsApp user is not authenticated');
		const account = await this.accountRepo.findOne({
			where: { id: accountId },
		});
		if (!account) throw new NotFoundException('WhatsApp account not found');
		if (this.isSuperAdmin(user) || account.ownerAdminId === user.id) {
			return this.fullAccess(account);
		}
		if (!this.isEligibleStaff(user)) {
			throw new ForbiddenException('WhatsApp account access denied');
		}
		const access = await this.accessRepo.findOne({
			where: { accountId, userId: user.id },
		});
		if (!access?.canView) throw new ForbiddenException('WhatsApp account access denied');
		return { account, ...access };
	}

	async listAccessibleAccounts(user: User) {
		if (!this.isEligibleStaff(user)) return [];
		if (this.isSuperAdmin(user)) {
			return this.accountRepo.find({
				order: { created_at: 'DESC' },
			});
		}

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
		for (const account of owned) byId.set(account.id, account);
		for (const row of rows) {
			if (row.account) byId.set(row.account.id, row.account);
		}
		return [...byId.values()].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);
	}

	async assertAccountPermission(
		user: User,
		accountId: string,
		permission: WhatsAppAccountPermission = 'canView',
	) {
		const { account, ...access } = await this.getAccountAccess(user, accountId);
		if (!access?.[permission]) {
			throw new ForbiddenException(`WhatsApp account permission denied: ${permission}`);
		}
		return account;
	}

	async assertConversationVisible(user: User, conversationId: string) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
			relations: ['contact', 'group', 'group.participants', 'assignedUser'],
		});
		if (!conversation) throw new NotFoundException('WhatsApp conversation not found');
		const accountAccess = await this.getAccountAccess(user, conversation.accountId);
		const canSeeAll = this.canSeeAllConversations(user, accountAccess);
		if (!accountAccess.canView || (!canSeeAll && conversation.assignedUserId !== user.id)) {
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
		// Unassigned chats are only visible to owners / managers / assigners.
		return [
			...new Set([
				account.ownerAdminId,
				...rows
					.filter((row) => row.canManage || row.canAssign)
					.map((row) => row.userId)
					.filter(Boolean),
			]),
		];
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

		return this.accessRepo.find({
			where: { accountId },
			relations: ['user'],
			order: { created_at: 'ASC' },
		});
	}
}
