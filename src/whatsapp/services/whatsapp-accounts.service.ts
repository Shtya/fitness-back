import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../../entities/global.entity';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppAuditLog,
	WhatsAppAccountStatus,
	WhatsAppConnectionLog,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppGroup,
	WhatsAppStatus,
} from '../entities/whatsapp.entity';
import { forceReleaseWppBrowserProfile } from '../utils/whatsapp-browser-profile';
import {
	getWhatsAppPrivacySettings,
	mergeWhatsAppPrivacySettings,
	WhatsAppPrivacySettings,
} from '../utils/whatsapp-privacy';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';

export function resolveWhatsAppSyncPhase(account: {
	status?: string | null;
	initialHydratedAt?: Date | string | null;
}): 'disconnected' | 'connecting' | 'hydrating' | 'ready' | 'error' {
	const status = String(account?.status || '');
	if (status === 'error') return 'error';
	if (status === 'connecting' || status === 'qr_pending') return 'connecting';
	if (status !== 'connected') return 'disconnected';
	if (!account.initialHydratedAt) return 'hydrating';
	return 'ready';
}

const whatsappMediaRoot = () =>
	path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT ||
			path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);

async function removeAccountMedia(accountId: string) {
	const root = whatsappMediaRoot();
	await Promise.all([
		fs.rm(path.join(root, accountId), { recursive: true, force: true }),
		fs.rm(path.join(root, 'outgoing', accountId), { recursive: true, force: true }),
		fs.rm(path.join(root, 'statuses', accountId), { recursive: true, force: true }),
		fs.rm(path.join(process.cwd(), 'uploads', 'whatsapp-media', accountId), {
			recursive: true,
			force: true,
		}),
	]);
}

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
		private readonly providers: WhatsAppProviderManagerService,
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
					connectionMethod:
						account.providerCapabilities?.connectionMethod === 'pairing_code'
							? 'pairing_code'
							: account.providerCapabilities?.connectionMethod === 'qr'
								? 'qr'
								: null,
					providerName: account.providerName,
					status: account.status,
					syncPhase: resolveWhatsAppSyncPhase(account),
					initialHydratedAt: account.initialHydratedAt || null,
					lastHistorySyncAt: account.lastHistorySyncAt || null,
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
					providerName:
						input.providerName ||
						process.env.WHATSAPP_PROVIDER ||
						'baileys',
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
		// Kill live provider, wipe disk sessions, drop Redis locks BEFORE deleting DB rows.
		await this.providers.destroySession(accountId, account.providerName || 'baileys');
		await removeAccountMedia(accountId);
		await this.accountRepo.manager.transaction(async manager => {
			await manager.delete(WhatsAppAuditLog, { accountId });
			await manager.delete(WhatsAppConnectionLog, { accountId });
			await manager.delete(WhatsAppConversation, { accountId });
			await manager.delete(WhatsAppContact, { accountId });
			await manager.delete(WhatsAppGroup, { accountId });
			await manager.delete(WhatsAppStatus, { accountId });
			await manager.delete(WhatsAppAccountAccess, { accountId });
			await manager.delete(WhatsAppAccount, { id: accountId });
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId: null,
			action: 'whatsapp.account.deleted',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
			metadata: { label: account.label },
		});
		return { ok: true };
	}

	async resetData(user: User, accountId: string) {
		const account = await this.accessService.assertAccountPermission(
			user,
			accountId,
			'canManage',
		);
		const provider = this.providers.getProvider(accountId);
		let canResyncNow = false;
		if (provider?.getState() === 'connected') {
			try {
		const chats = await provider.getChats(500);
				canResyncNow = Array.isArray(chats) && chats.length > 0;
			} catch {
				canResyncNow = false;
			}
		}

		// When the browser/session is broken (common in production after a crash),
		// close Chromium + clear SingletonLock first. Keep WhatsApp link tokens.
		if (!canResyncNow) {
			await this.providers.disconnect(accountId, false).catch(() => undefined);
			await forceReleaseWppBrowserProfile(accountId).catch(() => undefined);
		}

		await removeAccountMedia(accountId);
		await this.accountRepo.manager.transaction(async manager => {
			// Preserve the account, provider session and staff access; purge synchronized data only.
			await manager.delete(WhatsAppAuditLog, { accountId });
			await manager.delete(WhatsAppConversation, { accountId });
			await manager.delete(WhatsAppContact, { accountId });
			await manager.delete(WhatsAppGroup, { accountId });
			await manager.delete(WhatsAppStatus, { accountId });
			await manager.delete(WhatsAppConnectionLog, { accountId });
			await manager.update(WhatsAppAccount, accountId, {
				lastError: null,
				initialHydratedAt: null,
				lastHistorySyncAt: null,
			});
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.account.data_reset',
			targetType: 'WhatsAppAccount',
			targetId: accountId,
		});

		if (canResyncNow) {
			return {
				ok: true,
				status: account.status,
				readyToSync: true,
			};
		}

		try {
			const reconnected = await this.providers.connect(accountId);
			const ready = await this.providers.waitUntilConnected(accountId, 45_000);
			return {
				ok: true,
				status: reconnected.getState(),
				readyToSync: Boolean(ready),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: true,
				status: 'error',
				readyToSync: false,
				reconnectError: message,
			};
		}
	}

	async getAccess(user: User, accountId: string) {
		await this.accessService.assertAccountPermission(user, accountId, 'canManage');
		return this.accessRepo.find({
			where: { accountId },
			relations: ['user'],
			order: { created_at: 'ASC' },
		});
	}

	/** Staff who can appear in the Assign menu, with account permission flags. */
	async listAssignableStaff(user: User, accountId: string) {
		const access = await this.accessService.getAccountAccess(user, accountId);
		if (!access.canAssign && !access.canManage) {
			throw new ForbiddenException('WhatsApp account permission denied: canAssign');
		}
		const account = access.account;
		if (!account) return [];
		const [eligible, rows] = await Promise.all([
			this.listEligibleStaff(user),
			this.accessRepo.find({
				where: { accountId },
				relations: ['user'],
				order: { created_at: 'ASC' },
			}),
		]);
		const accessByUser = new Map(rows.map((row) => [row.userId, row]));
		const byId = new Map<
			string,
			{
				id: string;
				name: string;
				email?: string;
				role?: string;
				avatarUrl?: string | null;
				isOwner: boolean;
				canView: boolean;
				canUse: boolean;
				canManage: boolean;
				canAssign: boolean;
				canTransfer: boolean;
				assignable: boolean;
			}
		>();
		const pushPerson = (
			person: { id: string; name: string; email?: string; role?: string; avatarUrl?: string | null },
			row?: WhatsAppAccountAccess | null,
		) => {
			if (!person?.id || byId.has(person.id)) return;
			const isOwner = person.id === account.ownerAdminId;
			const canView = isOwner || Boolean(row?.canView);
			const canUse = isOwner || Boolean(row?.canUse);
			byId.set(person.id, {
				id: person.id,
				name: person.name || person.email || 'Staff',
				email: person.email,
				role: person.role,
				avatarUrl: person.avatarUrl || null,
				isOwner,
				canView,
				canUse,
				canManage: isOwner || Boolean(row?.canManage),
				canAssign: isOwner || Boolean(row?.canAssign),
				canTransfer: isOwner || Boolean(row?.canTransfer),
				assignable: canView && canUse,
			});
		};
		for (const person of eligible) {
			pushPerson(
				{
					id: person.id,
					name: person.name,
					email: person.email,
					role: person.role,
					avatarUrl: null,
				},
				accessByUser.get(person.id) || null,
			);
		}
		for (const row of rows) {
			if (row.user) {
				pushPerson(
					{
						id: row.user.id,
						name: row.user.name,
						email: row.user.email,
						role: row.user.role,
						avatarUrl: (row.user as any).avatarUrl || null,
					},
					row,
				);
			}
		}
		// Access rows whose user relation did not load (soft-delete / missing join).
		const missingAccessIds = rows
			.map((row) => row.userId)
			.filter((id) => id && !byId.has(id));
		const mustLoadIds = [
			...new Set(
				[
					user.id,
					account.ownerAdminId,
					...missingAccessIds,
				].filter(Boolean),
			),
		].filter((id) => !byId.has(id as string)) as string[];
		if (mustLoadIds.length) {
			const extras = await this.userRepo.find({
				where: { id: In(mustLoadIds) },
				select: ['id', 'name', 'email', 'role'],
			});
			for (const person of extras) {
				pushPerson(person, accessByUser.get(person.id) || null);
			}
		}
		return [...byId.values()].sort((a, b) =>
			String(a.name || '').localeCompare(String(b.name || '')),
		);
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
		if (user.role === UserRole.SUPER_ADMIN) {
			return this.userRepo.find({
				where: { role: In(roles) },
				select: ['id', 'name', 'email', 'role', 'status'],
				order: { name: 'ASC' },
			});
		}
		const where: Array<Record<string, unknown>> = [
			{ id: user.id, role: In(roles) },
			{ adminId: user.id, role: In(roles) },
			{ coachId: user.id, role: In(roles) },
		];
		// Same org / tenant staff (admin tree often shares tenantId).
		if (user.tenantId) {
			where.push({ tenantId: user.tenantId, role: In(roles) });
		}
		if (user.adminId) {
			where.push({ adminId: user.adminId, role: In(roles) });
			where.push({ id: user.adminId, role: In(roles) });
		}
		const rows = await this.userRepo.find({
			where: where as any,
			select: ['id', 'name', 'email', 'role', 'status'],
			order: { name: 'ASC' },
		});
		const byId = new Map(rows.map((row) => [row.id, row]));
		return [...byId.values()].sort((a, b) =>
			String(a.name || '').localeCompare(String(b.name || '')),
		);
	}
}
