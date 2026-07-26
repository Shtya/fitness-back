import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { WhatsAppAccountStatus } from '../entities/whatsapp.entity';

describe('WhatsAppProviderManagerService event isolation', () => {
	function createService() {
		const accountRepo = {
			update: jest.fn().mockResolvedValue(undefined),
			findOneBy: jest.fn().mockResolvedValue({
				status: WhatsAppAccountStatus.DISCONNECTED,
			}),
			findOneByOrFail: jest.fn().mockResolvedValue({
				id: 'account-1',
				status: WhatsAppAccountStatus.DISCONNECTED,
				providerName: 'wppconnect',
			}),
		};
		const logRepo = {
			create: jest.fn(value => value),
			save: jest.fn().mockResolvedValue(undefined),
		};
		const accessRepo = {
			find: jest.fn().mockResolvedValue([]),
		};
		const messageRepo = {
			findOne: jest.fn().mockResolvedValue(null),
			save: jest.fn(),
		};
		const gateway = {
			emitAccountEvent: jest.fn(),
		};
		const notifications = {
			create: jest.fn(),
		};
		const sessions = {
			clear: jest.fn().mockResolvedValue(true),
		};
		const redisClient = {
			set: jest.fn().mockResolvedValue('OK'),
			get: jest.fn().mockResolvedValue(null),
			del: jest.fn().mockResolvedValue(1),
			expire: jest.fn().mockResolvedValue(true),
		};
		const redis = {
			getClient: jest.fn().mockReturnValue(redisClient),
			isReady: jest.fn().mockReturnValue(true),
			isAvailable: jest.fn().mockResolvedValue(true),
		};
		const service = new WhatsAppProviderManagerService(
			accountRepo as any,
			logRepo as any,
			accessRepo as any,
			messageRepo as any,
			sessions as any,
			gateway as any,
			notifications as any,
			redis as any,
		);
		return { service, accountRepo, logRepo, gateway, sessions, redis, redisClient };
	}

	it('never broadcasts message content to the account room', async () => {
		const { service, gateway } = createService();

		await (service as any).handleEvent('account-1', {
			type: 'message',
			message: {
				providerMessageId: 'provider-1',
				chatId: '201000000000@c.us',
				text: 'private message',
				raw: { secret: 'must-not-leak' },
			},
		});

		expect(gateway.emitAccountEvent).not.toHaveBeenCalled();
	});

	it('never broadcasts pairing QR codes to canView account rooms', async () => {
		const { service, gateway, accountRepo } = createService();

		await (service as any).handleEvent('account-1', {
			type: 'qr',
			qr: 'data:image/png;base64,secret-pairing-code',
		});

		expect(accountRepo.update).toHaveBeenCalledWith('account-1', {
			status: WhatsAppAccountStatus.QR_PENDING,
		});
		expect(gateway.emitAccountEvent).not.toHaveBeenCalled();
	});

	it('ignores stale QR events while the account is already connected', async () => {
		const { service, gateway, accountRepo } = createService();
		accountRepo.findOneBy.mockResolvedValue({
			status: WhatsAppAccountStatus.CONNECTED,
		});
		(service as any).providers.set('account-1', {
			getState: jest.fn().mockReturnValue('connected'),
		});

		await (service as any).handleEvent('account-1', {
			type: 'qr',
			qr: 'data:image/png;base64,secret-pairing-code',
		});

		expect(accountRepo.update).not.toHaveBeenCalled();
		expect(gateway.emitAccountEvent).not.toHaveBeenCalled();
	});

	it('accepts QR events when the in-memory provider is actually waiting for pairing', async () => {
		const { service, accountRepo } = createService();
		accountRepo.findOneBy.mockResolvedValue({
			status: WhatsAppAccountStatus.CONNECTED,
		});
		(service as any).providers.set('account-1', {
			getState: jest.fn().mockReturnValue('qr_pending'),
		});

		await (service as any).handleEvent('account-1', {
			type: 'qr',
			qr: 'data:image/png;base64,new-pairing-code',
		});

		expect(accountRepo.update).toHaveBeenCalledWith('account-1', {
			status: WhatsAppAccountStatus.QR_PENDING,
		});
	});

	it('broadcasts only sanitized connection state', async () => {
		const { service, gateway, logRepo } = createService();

		await (service as any).handleEvent('account-1', {
			type: 'connection',
			status: WhatsAppAccountStatus.CONNECTED,
			phoneNumber: '201000000000',
			token: 'provider-secret',
		});

		expect(gateway.emitAccountEvent).toHaveBeenCalledWith('account-1', 'connection', {
			status: WhatsAppAccountStatus.CONNECTED,
		});
		expect(logRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { status: WhatsAppAccountStatus.CONNECTED },
			}),
		);
	});

	it('reuses an already connected provider instead of connecting twice', async () => {
		const { service, accountRepo } = createService();
		const provider = {
			getState: jest.fn().mockReturnValue('connected'),
		};
		(service as any).providers.set('account-1', provider);

		await expect(service.connect('account-1')).resolves.toBe(provider);
		expect(accountRepo.update).not.toHaveBeenCalled();
	});

	it('stores lastError and drops a timed-out connecting provider', async () => {
		const { service, accountRepo } = createService();
		const provider = {
			getState: jest.fn().mockReturnValue('error'),
			disconnect: jest.fn().mockResolvedValue(undefined),
		};
		(service as any).providers.set('account-1', provider);
		(service as any).connectStartedAt.set('account-1', Date.now() - 1000);

		await (service as any).handleEvent('account-1', {
			type: 'connection',
			status: WhatsAppAccountStatus.ERROR,
			error: 'WhatsApp connection timed out',
		});

		expect(accountRepo.update).toHaveBeenCalledWith(
			'account-1',
			expect.objectContaining({
				status: WhatsAppAccountStatus.ERROR,
				lastError: 'WhatsApp connection timed out',
			}),
		);
		expect((service as any).providers.has('account-1')).toBe(false);
		expect((service as any).connectStartedAt.has('account-1')).toBe(false);
	});

	it('restarts a stuck connecting provider instead of reusing it forever', async () => {
		const { service, accountRepo, redisClient } = createService();
		accountRepo.findOneByOrFail.mockResolvedValue({
			id: 'account-1',
			status: WhatsAppAccountStatus.CONNECTING,
			providerName: 'wppconnect',
		});
		const stale = {
			getState: jest.fn().mockReturnValue('connecting'),
			disconnect: jest.fn().mockResolvedValue(undefined),
			onEvent: jest.fn(),
			connect: jest.fn().mockResolvedValue(undefined),
		};
		(service as any).providers.set('account-1', stale);
		(service as any).connectStartedAt.set('account-1', Date.now() - 120_000);
		const fresh = {
			getState: jest.fn().mockReturnValue('connecting'),
			onEvent: jest.fn(),
			connect: jest.fn().mockResolvedValue(undefined),
		};
		jest
			.spyOn(service as any, 'createProvider')
			.mockReturnValue(fresh);

		await expect(service.connect('account-1')).resolves.toBe(fresh);
		expect(stale.disconnect).toHaveBeenCalledTimes(1);
		expect(fresh.connect).toHaveBeenCalledTimes(1);
		expect(redisClient.set).toHaveBeenCalled();
	});

	it('disconnects the provider and removes it from the active map', async () => {
		const { service, accountRepo } = createService();
		const provider = {
			disconnect: jest.fn().mockResolvedValue(undefined),
			logout: jest.fn().mockResolvedValue(undefined),
		};
		(service as any).providers.set('account-1', provider);

		await expect(service.disconnect('account-1', false)).resolves.toEqual({ ok: true });
		expect(provider.disconnect).toHaveBeenCalledTimes(1);
		expect((service as any).providers.has('account-1')).toBe(false);
		expect(accountRepo.update).toHaveBeenCalledWith(
			'account-1',
			expect.objectContaining({ status: WhatsAppAccountStatus.DISCONNECTED }),
		);
	});

	it('clears the saved session even when provider logout fails', async () => {
		const { service, sessions } = createService();
		const provider = {
			logout: jest.fn().mockRejectedValue(new Error('provider unavailable')),
		};
		(service as any).providers.set('account-1', provider);

		await expect(service.destroySession('account-1', 'wppconnect')).resolves.toEqual({
			ok: true,
		});
		expect(sessions.clear).toHaveBeenCalledWith('account-1', 'wppconnect');
		expect((service as any).providers.has('account-1')).toBe(false);
	});

	it('skips Redis lock commands when Redis is unavailable', async () => {
		const { service, redis, redisClient, accountRepo } = createService();
		redis.isAvailable.mockResolvedValue(false);
		accountRepo.findOneByOrFail.mockResolvedValue({
			id: 'account-1',
			status: WhatsAppAccountStatus.DISCONNECTED,
			providerName: 'wppconnect',
		});
		const fresh = {
			getState: jest.fn().mockReturnValue('connecting'),
			onEvent: jest.fn(),
			connect: jest.fn().mockResolvedValue(undefined),
			disconnect: jest.fn().mockResolvedValue(undefined),
		};
		jest.spyOn(service as any, 'createProvider').mockReturnValue(fresh);

		await expect(service.connect('account-1')).resolves.toBe(fresh);
		expect(redisClient.set).not.toHaveBeenCalled();
		expect(redis.getClient).not.toHaveBeenCalled();

		await expect(service.disconnect('account-1', false)).resolves.toEqual({ ok: true });
		expect(redisClient.del).not.toHaveBeenCalled();
	});
});
