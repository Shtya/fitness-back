import { BaileysProvider } from './baileys.provider';

function makeProvider(me: Record<string, any>) {
	const provider: any = Object.create(BaileysProvider.prototype);
	provider.state = 'connected';
	provider.accountId = 'acc-1';
	provider.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
	provider.contacts = new Map();
	provider.lidToPn = new Map();
	provider.onlinePresence = false;
	provider.availabilityError = null;
	provider.socket = {
		authState: { creds: { me } },
		sendPresenceUpdate: jest.fn(async () => undefined),
	};
	return provider;
}

describe('BaileysProvider device availability', () => {
	it('learns our push name from a message we sent, then can go available', async () => {
		const provider = makeProvider({ id: '201551495772:12@s.whatsapp.net' });
		expect(await provider.setOnlinePresence(true)).toBe(false);
		expect(provider.presenceDiagnostics().availabilityError).toMatch(/no push name/);

		provider.learnOwnPushName({ key: { fromMe: true }, pushName: 'Ahmed' });
		expect(provider.socket.authState.creds.me.name).toBe('Ahmed');
		expect(await provider.setOnlinePresence(true)).toBe(true);
		expect(provider.socket.sendPresenceUpdate).toHaveBeenCalledWith('available');
		expect(provider.presenceDiagnostics()).toMatchObject({ deviceAvailable: true, hasPushName: true, availabilityError: null });
	});

	it("never takes a contact's name as ours", () => {
		const provider = makeProvider({ id: '201551495772:12@s.whatsapp.net' });
		provider.learnOwnPushName({ key: { fromMe: false }, pushName: 'Someone else' });
		expect(provider.socket.authState.creds.me.name).toBeUndefined();
	});

	it('keeps an existing push name', () => {
		const provider = makeProvider({ id: '1@s.whatsapp.net', name: 'Real' });
		provider.learnOwnPushName({ key: { fromMe: true }, pushName: 'Other' });
		expect(provider.socket.authState.creds.me.name).toBe('Real');
	});
});
