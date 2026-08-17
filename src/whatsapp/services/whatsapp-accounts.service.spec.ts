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
import * as browserProfile from '../utils/whatsapp-browser-profile';
import { WhatsAppAccountsService, resolveWhatsAppSyncPhase } from './whatsapp-accounts.service';

describe('WhatsAppAccountsService resetData', () => {
	beforeEach(() => {
		jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
		jest
			.spyOn(browserProfile, 'forceReleaseWppBrowserProfile')
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function buildService(overrides: {
		provider?: any;
		connect?: jest.Mock;
		disconnect?: jest.Mock;
		waitUntilConnected?: jest.Mock;
	} = {}) {
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
			getProvider: jest.fn().mockReturnValue(overrides.provider ?? null),
			disconnect: overrides.disconnect || jest.fn().mockResolvedValue({ ok: true }),
			connect:
				overrides.connect ||
				jest.fn().mockResolvedValue({
					getState: jest.fn().mockReturnValue('connected'),
				}),
			waitUntilConnected:
				overrides.waitUntilConnected || jest.fn().mockResolvedValue(true),
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
		return { service, manager, providers, audit };
	}

	it('purges synchronized data while preserving the account and provider session', async () => {
		const { service, manager, providers, audit } = buildService({
			provider: {
				getState: jest.fn().mockReturnValue('connected'),
				getChats: jest.fn().mockResolvedValue([{ id: '201000000000@c.us' }]),
			},
		});

		await expect(
			service.resetData({ id: 'user-1' } as any, 'account-1'),
		).resolves.toEqual({
			ok: true,
			status: 'connected',
			readyToSync: true,
		});

		expect(providers.destroySession).not.toHaveBeenCalled();
		expect(providers.disconnect).not.toHaveBeenCalled();
		expect(providers.connect).not.toHaveBeenCalled();
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

	it('recovers a broken browser session, purges data, then reconnects', async () => {
		const disconnect = jest.fn().mockResolvedValue({ ok: true });
		const connect = jest.fn().mockResolvedValue({
			getState: jest.fn().mockReturnValue('connected'),
		});
		const waitUntilConnected = jest.fn().mockResolvedValue(true);
		const { service, providers } = buildService({
			provider: {
				getState: jest.fn().mockReturnValue('error'),
				getChats: jest.fn(),
			},
			disconnect,
			connect,
			waitUntilConnected,
		});

		await expect(
			service.resetData({ id: 'user-1' } as any, 'account-1'),
		).resolves.toEqual({
			ok: true,
			status: 'connected',
			readyToSync: true,
		});

		expect(disconnect).toHaveBeenCalledWith('account-1', false);
		expect(browserProfile.forceReleaseWppBrowserProfile).toHaveBeenCalledWith(
			'account-1',
		);
		expect(connect).toHaveBeenCalledWith('account-1');
		expect(waitUntilConnected).toHaveBeenCalled();
		expect(providers.destroySession).not.toHaveBeenCalled();
	});
});

describe('resolveWhatsAppSyncPhase', () => {
	it('treats a connected hydrated account as ready', () => {
		expect(
			resolveWhatsAppSyncPhase({
				status: 'connected',
				initialHydratedAt: new Date(),
			}),
		).toBe('ready');
	});

	it('keeps a connected but empty account in hydrating', () => {
		expect(resolveWhatsAppSyncPhase({ status: 'connected' })).toBe('hydrating');
		expect(resolveWhatsAppSyncPhase({ status: 'qr_pending' })).toBe('connecting');
		expect(resolveWhatsAppSyncPhase({ status: 'error' })).toBe('error');
	});
});
