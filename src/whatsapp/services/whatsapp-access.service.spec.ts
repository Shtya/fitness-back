import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../entities/global.entity';
import { WhatsAppAccessService } from './whatsapp-access.service';

describe('WhatsAppAccessService', () => {
	const account = { id: 'account-1', ownerAdminId: 'owner-1' };

	function createService(accessRow?: Record<string, unknown>) {
		const accountRepo = {
			findOne: jest.fn().mockResolvedValue(account),
			find: jest.fn().mockResolvedValue([]),
		};
		const accessRepo = {
			findOne: jest.fn().mockResolvedValue(accessRow || null),
			find: jest.fn().mockResolvedValue([]),
		};
		const userRepo = { find: jest.fn() };
		const conversationRepo = { findOne: jest.fn() };
		return {
			service: new WhatsAppAccessService(
				accountRepo as any,
				accessRepo as any,
				userRepo as any,
				conversationRepo as any,
			),
			accountRepo,
			accessRepo,
			conversationRepo,
		};
	}

	it('grants the owner full access', async () => {
		const { service } = createService();
		await expect(
			service.getAccountAccess({ id: 'owner-1', role: UserRole.ADMIN } as any, 'account-1'),
		).resolves.toMatchObject({
			canView: true,
			canUse: true,
			canManage: true,
			canAssign: true,
			canTransfer: true,
		});
	});

	it('honors scoped staff permissions', async () => {
		const { service } = createService({
			accountId: 'account-1',
			userId: 'coach-1',
			canView: true,
			canUse: false,
			canManage: false,
			canAssign: false,
			canTransfer: false,
		});
		const access = await service.getAccountAccess(
			{ id: 'coach-1', role: UserRole.COACH } as any,
			'account-1',
		);
		expect(access.canView).toBe(true);
		expect(access.canUse).toBe(false);
		await expect(
			service.assertAccountPermission(
				{ id: 'coach-1', role: UserRole.COACH } as any,
				'account-1',
				'canUse',
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('revokes stale delegated access after a role downgrade to client', async () => {
		const { service } = createService({
			accountId: 'account-1',
			userId: 'client-1',
			canView: true,
			canUse: true,
		});
		await expect(
			service.getAccountAccess({ id: 'client-1', role: UserRole.CLIENT } as any, 'account-1'),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('returns no WhatsApp accounts for ineligible client roles', async () => {
		const { service, accountRepo, accessRepo } = createService();
		await expect(
			service.listAccessibleAccounts({
				id: 'client-1',
				role: UserRole.CLIENT,
			} as any),
		).resolves.toEqual([]);
		expect(accountRepo.find).not.toHaveBeenCalled();
		expect(accessRepo.find).not.toHaveBeenCalled();
	});

	it('does not let a super admin browse WhatsApp lines they do not own or share', async () => {
		const { service, accountRepo, accessRepo } = createService();
		await expect(
			service.getAccountAccess(
				{ id: 'super-1', role: UserRole.SUPER_ADMIN } as any,
				'account-1',
			),
		).rejects.toBeInstanceOf(ForbiddenException);

		accountRepo.find.mockResolvedValue([]);
		accessRepo.find.mockResolvedValue([]);
		await expect(
			service.listAccessibleAccounts({
				id: 'super-1',
				role: UserRole.SUPER_ADMIN,
			} as any),
		).resolves.toEqual([]);
		expect(accountRepo.find).toHaveBeenCalledWith(
			expect.objectContaining({ where: { ownerAdminId: 'super-1' } }),
		);
	});

	describe('account / access cache (audit P2)', () => {
		const coach = { id: 'coach-1', role: UserRole.COACH } as any;
		const coachAccess = { accountId: 'account-1', userId: 'coach-1', canView: true, canUse: true };

		it('reuses account and access rows across calls', async () => {
			const { service, accountRepo, accessRepo } = createService(coachAccess);
			await service.getAccountAccess(coach, 'account-1');
			await service.getAccountAccess(coach, 'account-1');
			await service.assertAccountPermission(coach, 'account-1', 'canUse');
			expect(accountRepo.findOne).toHaveBeenCalledTimes(1);
			expect(accessRepo.findOne).toHaveBeenCalledTimes(1);
		});

		it('hands out copies so a caller mutation cannot leak into the cache', async () => {
			const { service } = createService(coachAccess);
			const first = await service.getAccountAccess(coach, 'account-1');
			(first.account as any).label = 'mutated';
			(first as any).canUse = false;
			const second = await service.getAccountAccess(coach, 'account-1');
			expect((second.account as any).label).toBeUndefined();
			expect(second.canUse).toBe(true);
		});

		it('always reads fresh rows for canManage (callers may save the account)', async () => {
			const { service, accountRepo } = createService();
			const owner = { id: 'owner-1', role: UserRole.ADMIN } as any;
			await service.assertAccountPermission(owner, 'account-1', 'canView');
			await service.assertAccountPermission(owner, 'account-1', 'canManage');
			await service.assertAccountPermission(owner, 'account-1', 'canManage');
			expect(accountRepo.findOne).toHaveBeenCalledTimes(3);
		});

		it('drops cached rows when access is revoked', async () => {
			const { service, accessRepo } = createService(coachAccess);
			await service.getAccountAccess(coach, 'account-1');
			accessRepo.findOne.mockResolvedValue({ ...coachAccess, canView: false });
			service.invalidateAccount('account-1');
			await expect(service.getAccountAccess(coach, 'account-1')).rejects.toBeInstanceOf(
				ForbiddenException,
			);
		});

		it('expires cached rows after the TTL', async () => {
			jest.useFakeTimers({ now: new Date('2026-09-28T10:00:00Z') });
			try {
				const { service, accountRepo } = createService(coachAccess);
				await service.getAccountAccess(coach, 'account-1');
				jest.setSystemTime(new Date('2026-09-28T10:00:11Z'));
				await service.getAccountAccess(coach, 'account-1');
				expect(accountRepo.findOne).toHaveBeenCalledTimes(2);
			} finally {
				jest.useRealTimers();
			}
		});
	});

	describe('getUnreadTotal (audit P2)', () => {
		function unreadQueryBuilder(result: Record<string, unknown>) {
			const qb: any = {
				select: jest.fn(() => qb),
				addSelect: jest.fn(() => qb),
				where: jest.fn(() => qb),
				andWhere: jest.fn(() => qb),
				getRawOne: jest.fn().mockResolvedValue(result),
			};
			return qb;
		}

		it('sums every visible account in one query with per-account scoping', async () => {
			const { service, accountRepo, accessRepo, conversationRepo } = createService();
			const owned = { id: 'owned', ownerAdminId: 'coach-1', created_at: new Date('2026-01-02') };
			const managed = { id: 'managed', ownerAdminId: 'x', created_at: new Date('2026-01-01') };
			const scoped = { id: 'scoped', ownerAdminId: 'y', created_at: new Date('2026-01-03') };
			accountRepo.find.mockResolvedValue([owned]);
			accessRepo.find.mockResolvedValue([
				{ account: managed, canView: true, canManage: true },
				{ account: scoped, canView: true, canManage: false, canAssign: false },
			]);
			const qb = unreadQueryBuilder({ totalUnread: '7', unreadConversations: '3' });
			(conversationRepo as any).createQueryBuilder = jest.fn(() => qb);

			await expect(
				service.getUnreadTotal({ id: 'coach-1', role: UserRole.COACH } as any),
			).resolves.toEqual({ totalUnread: 7, unreadConversations: 3 });

			expect((conversationRepo as any).createQueryBuilder).toHaveBeenCalledTimes(1);
			expect(accountRepo.findOne).not.toHaveBeenCalled();
			expect(accessRepo.findOne).not.toHaveBeenCalled();
			const [clause, params] = qb.where.mock.calls[0];
			expect(clause).toContain('conversation.accountId IN (:...seeAllIds)');
			expect(clause).toContain('conversation.assignedUserId = :userId');
			expect(params.seeAllIds.sort()).toEqual(['managed', 'owned']);
			expect(params.assignedOnlyIds).toEqual(['scoped']);
		});

		it('omits empty IN lists', async () => {
			const { service, accountRepo, conversationRepo } = createService();
			accountRepo.find.mockResolvedValue([
				{ id: 'owned', ownerAdminId: 'coach-1', created_at: new Date() },
			]);
			const qb = unreadQueryBuilder({ totalUnread: null, unreadConversations: null });
			(conversationRepo as any).createQueryBuilder = jest.fn(() => qb);

			await expect(
				service.getUnreadTotal({ id: 'coach-1', role: UserRole.COACH } as any),
			).resolves.toEqual({ totalUnread: 0, unreadConversations: 0 });
			expect(qb.where.mock.calls[0][0]).not.toContain('assignedOnlyIds');
		});
	});

	it('enforces assignment visibility for scoped staff', async () => {
		const { service, conversationRepo } = createService({
			accountId: 'account-1',
			userId: 'coach-1',
			canView: true,
			canUse: true,
			canManage: false,
			canAssign: false,
		});
		conversationRepo.findOne.mockResolvedValue({
			id: 'conversation-1',
			accountId: 'account-1',
			assignedUserId: 'another-coach',
		});

		await expect(
			service.assertConversationVisible(
				{ id: 'coach-1', role: UserRole.COACH } as any,
				'conversation-1',
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});
});
