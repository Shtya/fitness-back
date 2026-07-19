import { randomBytes } from 'crypto';
import { WhatsAppSessionService } from './whatsapp-session.service';

describe('WhatsAppSessionService', () => {
	const originalKey = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;

	afterEach(() => {
		if (originalKey === undefined) delete process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
		else process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = originalKey;
	});

	function createService() {
		let stored: any = null;
		const repo = {
			findOne: jest.fn(async ({ where }) => {
				if (!stored) return null;
				if (where.isActive === true && !stored.isActive) return null;
				return stored.accountId === where.accountId &&
					stored.providerName === where.providerName
					? stored
					: null;
			}),
			create: jest.fn(value => ({ ...value })),
			save: jest.fn(async value => {
				stored = { ...value };
				return stored;
			}),
			update: jest.fn(async (_where, patch) => {
				if (stored) stored = { ...stored, ...patch };
			}),
		};
		return { service: new WhatsAppSessionService(repo as any), repo, getStored: () => stored };
	}

	it('encrypts tokens at rest and decrypts them on load', async () => {
		process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
		const { service, getStored } = createService();
		const token = { secret: 'provider-token', nested: { value: 1 } };

		await service.save('account-1', 'wppconnect', token);

		expect(getStored().encryptedData).not.toContain('provider-token');
		await expect(service.load('account-1', 'wppconnect')).resolves.toEqual(token);
	});

	it('updates the encrypted token without creating a second session row', async () => {
		process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
		const { service, repo } = createService();
		await service.save('account-1', 'wppconnect', { version: 1 });
		await service.save('account-1', 'wppconnect', { version: 2 });
		expect(repo.create).toHaveBeenCalledTimes(1);
		await expect(service.load('account-1', 'wppconnect')).resolves.toEqual({ version: 2 });
	});

	it('deactivates tokens on clear', async () => {
		process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
		const { service } = createService();
		await service.save('account-1', 'wppconnect', { token: true });
		await service.clear('account-1', 'wppconnect');
		await expect(service.load('account-1', 'wppconnect')).resolves.toBeUndefined();
	});

	it('fails closed when encryption key is missing or invalid', async () => {
		const { service } = createService();
		delete process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
		await expect(service.save('account-1', 'wppconnect', {})).rejects.toThrow(
			'WHATSAPP_SESSION_ENCRYPTION_KEY is not configured',
		);
		process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
		await expect(service.save('account-1', 'wppconnect', {})).rejects.toThrow(
			'must decode to 32 bytes',
		);
	});

	it('exposes a WPP token store scoped to one account', async () => {
		process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
		const { service } = createService();
		const store = service.createWppTokenStore('account-1');
		await store.setToken('ignored-session-name', { session: 'test' });
		await expect(store.getToken('ignored-session-name')).resolves.toEqual({ session: 'test' });
		await expect(store.listTokens()).resolves.toEqual(['account-1']);
		await store.removeToken('ignored-session-name');
		await expect(store.listTokens()).resolves.toEqual([]);
	});
});
