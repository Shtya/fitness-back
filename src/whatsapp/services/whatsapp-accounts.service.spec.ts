import { promises as fs } from 'fs';
import {
	WhatsAppAccount,
	WhatsAppAuditLog,
	WhatsAppConnectionLog,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppGroup,
	WhatsAppProviderSession,
	WhatsAppStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

describe('WhatsAppAccountsService resetData', () => {
	it('purges synchronized data while preserving the account and provider session', async () => {
		jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
		const manager = {
			delete: jest.fn().mockResolvedValue(undefined),
			update: jest.fn().mockResolvedValue(undefined),
		};
		const accountRepo = {
			manager: {
				transaction: jest.fn(async callback => callback(manager)),
			},
		};
		const access = {
			assertAccountPermission: jest.fn().mockResolvedValue({
				id: 'account-1',
				providerName: 'wppconnect',
				status: 'connected',
			}),
		};
		const providers = {
			destroySession: jest.fn().mockResolvedValue({ ok: true }),
			getProvider: jest.fn().mockReturnValue({
				getState: jest.fn().mockReturnValue('connected'),
				getChats: jest.fn().mockResolvedValue([{ id: '201000000000@c.us' }]),
			}),
		};
		const audit = {
			write: jest.fn().mockResolvedValue(undefined),
		};
		const service = new WhatsAppAccountsService(
			accountRepo as any,
			{} as any,
			{} as any,
			access as any,
			audit as any,
			providers as any,
		);

		await expect(
			service.resetData({ id: 'user-1' } as any, 'account-1'),
		).resolves.toEqual({ ok: true, status: 'connected' });

		expect(providers.destroySession).not.toHaveBeenCalled();
		for (const entity of [
			WhatsAppAuditLog,
			WhatsAppConversation,
			WhatsAppContact,
			WhatsAppGroup,
			WhatsAppStatus,
			WhatsAppConnectionLog,
		]) {
			expect(manager.delete).toHaveBeenCalledWith(entity, { accountId: 'account-1' });
		}
		expect(manager.delete).not.toHaveBeenCalledWith(WhatsAppProviderSession, {
			accountId: 'account-1',
		});
		expect(manager.update).toHaveBeenCalledWith(
			WhatsAppAccount,
			'account-1',
			expect.objectContaining({
				lastError: null,
			}),
		);
		expect(audit.write).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'whatsapp.account.data_reset' }),
		);
	});
});
