import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../../entities/global.entity';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppAccountStatus,
} from '../entities/whatsapp.entity';
import {
	getWhatsAppPrivacySettings,
	mergeWhatsAppPrivacySettings,
	WhatsAppPrivacySettings,
} from '../utils/whatsapp-privacy';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';

@Injectable()
export class WhatsAppAccountsService {
	constructor(
		@InjectRepository(WhatsAppAccount)
		private readonly accountRepo: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly accessRepo: Repository<WhatsAppAccountAccess>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly accessService: WhatsAppAccessService,
		private readonly audit: WhatsAppAuditService,
	) {}

	async list(user: User) {
		const accounts = await this.accessService.listAccessibleAccounts(user);
		const items: Array<Record<string, unknown>> = [];
		for (const account of accounts) {
			try {
				const access = await this.accessService.getAccountAccess(user, account.id);
				items.push({
					id: account.id,
					label: account.label,
					ownerAdminId: account.ownerAdminId,
					phoneNumber: account.phoneNumber,
					providerName: account.providerName,
					status: account.status,
					lastConnectedAt: account.lastConnectedAt,
					lastError: account.lastError,
					providerCapabilities: account.providerCapabilities || {},
					privacySettings: getWhatsAppPrivacySettings(account),
					created_at: (account as any).created_at,
					updated_at: (account as any).updated_at,
					currentAccess: {
						canView: Boolean(access.canView),
						canUse: Boolean(access.canUse),
						canManage: Boolean(access.canManage),
						canAssign: Boolean(access.canAssign),
						canTransfer: Boolean(access.canTransfer),
					},
				});
			} catch {
				// Skip stale access rows / accounts that are no longer readable.
			}
		}
		return items;
	}

	async create(user: User, input: { label: string; providerName?: string }) {
		const account = await this.accountRepo.manager.transaction(async manager => {
			const created = await manager.save(
				WhatsAppAccount,
				manager.create(WhatsAppAccount, {
					label: input.label.trim(),
					ownerAdminId: user.id,
					providerName: input.providerName || 'wppconnect',
					status: WhatsAppAccountStatus.DISCONNECTED,
					providerCapabilities: mergeWhatsAppPrivacySettings(
						{ providerCapabilities: {} },
						{
							hideStatusViewReceipts: true,
							readReceiptMode: 'on_reply',
						},
					),
				}),
			);
			await manager.save(
				WhatsAppAccountAccess,
				manager.create(WhatsAppAccountAccess, {
					accountId: created.id,
					userId: user.id,
					canView: true,
					canUse: true,
					canManage: true,
					canAssign: true,
					canTransfer: true,
				}),
			);
			return created;
		});

		await this.audit.write({
			actorUserId: user.id,
			accountId: account.id,
			action: 'whatsapp.account.created',
			targetType: 'WhatsAppAccount',
			targetId: account.id,
		});
		return account;
	}

	async remove(user: User, accountId: string) {
		const account = await this.accessService.assertAccountPermission(user, accountId, 'canManage');
		if (account.status !== WhatsAppAccountStatus.DISCONNECTED) {
			throw new NotFoundException('Disconnect the WhatsApp account before deleting it');
		}
		await this.accountRepo.softDelete(accountId);
		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.account.deleted',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
		});
		return { ok: true };
	}

	async getAccess(user: User, accountId: string) {
		await this.accessService.assertAccountPermission(user, accountId, 'canManage');
		return this.accessRepo.find({
			where: { accountId },
			relations: ['user'],
			order: { created_at: 'ASC' },
		});
	}

	async replaceAccess(user: User, accountId: string, access: any[]) {
		const result = await this.accessService.replaceAccountAccess(user, accountId, access);
		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.account.access_updated',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
			metadata: { userIds: access.map(item => item.userId) },
		});
		return result;
	}

	async getPrivacySettings(user: User, accountId: string) {
		const account = await this.accessService.assertAccountPermission(
			user,
			accountId,
			'canManage',
		);
		return getWhatsAppPrivacySettings(account);
	}

	async updatePrivacySettings(
		user: User,
		accountId: string,
		settings: WhatsAppPrivacySettings,
	) {
		const account = await this.accessService.assertAccountPermission(
			user,
			accountId,
			'canManage',
		);
		account.providerCapabilities = mergeWhatsAppPrivacySettings(account, settings);
		await this.accountRepo.save(account);
		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.account.privacy_updated',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
			metadata: settings,
		});
		return getWhatsAppPrivacySettings(account);
	}

	async listEligibleStaff(user: User) {
		const roles = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN];
		const where =
			user.role === UserRole.SUPER_ADMIN
				? { role: In(roles) }
				: [
						{ id: user.id, role: In(roles) },
						{ adminId: user.id, role: In(roles) },
						{ coachId: user.id, role: In(roles) },
					];
		return this.userRepo.find({
			where: where as any,
			select: ['id', 'name', 'email', 'role', 'status'],
			order: { name: 'ASC' },
		});
	}
}
