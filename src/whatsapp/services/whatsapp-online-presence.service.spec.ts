import { WhatsAppOnlinePresenceService } from './whatsapp-online-presence.service';

function setup(watchers: number, mode?: string) {
	const previous = process.env.WHATSAPP_ONLINE_PRESENCE;
	if (mode === undefined) delete process.env.WHATSAPP_ONLINE_PRESENCE;
	else process.env.WHATSAPP_ONLINE_PRESENCE = mode;
	let online = false;
	const provider = {
		isOnlinePresence: jest.fn(() => online),
		setOnlinePresence: jest.fn(async (value: boolean) => {
			online = value;
			return true;
		}),
	};
	const providers = { getProvider: jest.fn(() => provider), onProviderEvent: jest.fn(() => () => undefined) };
	const gateway = {
		accountWatcherCount: jest.fn(() => watchers),
		onAccountWatchersChanged: jest.fn(() => () => undefined),
	};
	const contactPresence = { subscribeRecentDirectChats: jest.fn().mockResolvedValue({ ok: true }) };
	const service = new WhatsAppOnlinePresenceService(providers as any, gateway as any, contactPresence as any);
	if (previous === undefined) delete process.env.WHATSAPP_ONLINE_PRESENCE;
	else process.env.WHATSAPP_ONLINE_PRESENCE = previous;
	return { service, provider, gateway, contactPresence, setWatchers: (n: number) => (watchers = n) };
}

describe('WhatsAppOnlinePresenceService', () => {
	it('marks the device available while someone watches the inbox and renews subscriptions', async () => {
		const { service, provider, contactPresence } = setup(1);
		await service.reconcile('acc');
		expect(provider.setOnlinePresence).toHaveBeenCalledWith(true);
		expect(contactPresence.subscribeRecentDirectChats).toHaveBeenCalledWith('acc', 200, true, { resend: true });
	});

	it('does not resend available on every reconcile', async () => {
		const { service, provider } = setup(2);
		await service.reconcile('acc');
		await service.reconcile('acc');
		expect(provider.setOnlinePresence).toHaveBeenCalledTimes(1);
	});

	it('goes unavailable when the last watcher leaves (phone notifications resume)', async () => {
		const { service, provider, setWatchers } = setup(1);
		await service.reconcile('acc');
		setWatchers(0);
		await service.reconcile('acc');
		expect(provider.setOnlinePresence).toHaveBeenLastCalledWith(false);
	});

	it('honours WHATSAPP_ONLINE_PRESENCE=off and =always', async () => {
		const off = setup(3, 'off');
		await off.service.reconcile('acc');
		expect(off.provider.setOnlinePresence).not.toHaveBeenCalled();

		const always = setup(0, 'always');
		await always.service.reconcile('acc');
		expect(always.provider.setOnlinePresence).toHaveBeenCalledWith(true);
	});

	it('never throws into the socket path when the provider fails', async () => {
		const { service, provider } = setup(1);
		provider.setOnlinePresence.mockRejectedValueOnce(new Error('socket closed'));
		await expect(service.reconcile('acc')).resolves.toBeUndefined();
	});
});
