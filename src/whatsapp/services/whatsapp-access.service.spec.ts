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
