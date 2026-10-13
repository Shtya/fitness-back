import { BaileysProvider } from './baileys.provider';
import { WhatsAppProviderUnavailableError } from './whatsapp-provider';

function provider(socket: Record<string, unknown> | null, state = 'connected') {
	const instance = new BaileysProvider('acc-contacts') as any;
	instance.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	instance.socket = socket;
	instance.state = state;
	instance.connect = jest.fn(async () => undefined);
	return instance;
}

/** Shape of Baileys' assertNodeErrorFree() rejection. */
function serverRefusal(code: number, text: string) {
	return Object.assign(new Error(text), { data: code });
}

describe('Baileys number lookup', () => {
	it('reports a registered number with the JID WhatsApp answered with', async () => {
		const onWhatsApp = jest.fn(async () => [{ jid: '97455500001@s.whatsapp.net', exists: true }]);
		const result = await provider({ onWhatsApp }).checkWhatsAppNumbers(['97455500001']);
		expect(onWhatsApp).toHaveBeenCalledWith('97455500001@s.whatsapp.net');
		expect(result).toEqual([
			{ phoneDigits: '97455500001', exists: true, chatId: '97455500001@c.us' },
		]);
	});

	it('reports not registered when WhatsApp returns no account', async () => {
		const result = await provider({ onWhatsApp: jest.fn(async () => []) }).checkWhatsAppNumbers([
			'97455500002',
		]);
		expect(result).toEqual([{ phoneDigits: '97455500002', exists: false, chatId: null }]);
	});

	it('throws (never "not registered") when WhatsApp gives no answer', async () => {
		await expect(
			provider({ onWhatsApp: jest.fn(async () => undefined) }).checkWhatsAppNumbers(['97455500003']),
		).rejects.toThrow('did not answer');
		await expect(
			provider({ onWhatsApp: jest.fn(async () => Promise.reject(new Error('socket closed'))) })
				.checkWhatsAppNumbers(['97455500003']),
		).rejects.toThrow('socket closed');
	});

	it('does not touch or reconnect the session when disconnected', async () => {
		const onWhatsApp = jest.fn();
		const instance = provider({ onWhatsApp }, 'disconnected');
		const error = await instance.checkWhatsAppNumbers(['97455500004']).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(WhatsAppProviderUnavailableError);
		expect((error as WhatsAppProviderUnavailableError).reason).toBe('not_connected');
		expect(onWhatsApp).not.toHaveBeenCalled();
		expect(instance.connect).not.toHaveBeenCalled();
	});

	it('flags an integration without onWhatsApp as unsupported', async () => {
		const error = await provider({}).checkWhatsAppNumbers(['97455500005']).catch((e: unknown) => e);
		expect((error as WhatsAppProviderUnavailableError).reason).toBe('unsupported');
	});
});

describe('Baileys number profile', () => {
	it('returns only fields WhatsApp shared', async () => {
		const setAt = new Date('2026-01-02T00:00:00Z');
		const instance = provider({
			profilePictureUrl: jest.fn(async () => 'https://pps.whatsapp.net/v/pic.jpg'),
			fetchStatus: jest.fn(async () => [{ id: 'x', status: { status: 'Hello there', setAt } }]),
			getBusinessProfile: jest.fn(async () => ({
				description: 'Bakery',
				category: 'Food',
				email: '',
				website: ['https://example.test'],
				address: null,
			})),
		});
		instance.contacts.set('97455500006@c.us', { id: '97455500006@c.us', notify: 'Sam' });
		const profile = await instance.getNumberProfile('97455500006@c.us');
		expect(profile.picture).toEqual({ status: 'available', url: 'https://pps.whatsapp.net/v/pic.jpg' });
		expect(profile.about).toEqual({ status: 'available', text: 'Hello there', setAt });
		expect(profile.business).toEqual({
			status: 'available',
			description: 'Bakery',
			category: 'Food',
			email: null,
			websites: ['https://example.test'],
			address: null,
		});
		expect(profile.pushName).toBe('Sam');
		expect(profile.savedName).toBeNull();
	});

	it('treats privacy refusals as hidden and other failures as errors', async () => {
		const hidden = await provider({
			profilePictureUrl: jest.fn(async () => Promise.reject(serverRefusal(401, 'not-authorized'))),
			fetchStatus: jest.fn(async () => [{ id: 'x', status: { status: null, setAt: new Date(0) } }]),
			getBusinessProfile: jest.fn(async () => undefined),
		}).getNumberProfile('97455500007@c.us');
		expect(hidden.picture).toEqual({ status: 'hidden', url: null });
		expect(hidden.about).toEqual({ status: 'hidden', text: null, setAt: null });
		expect(hidden.business).toEqual({ status: 'not_business' });
		expect(hidden.pushName).toBeNull();

		const missing = await provider({
			profilePictureUrl: jest.fn(async () => Promise.reject(serverRefusal(404, 'item-not-found'))),
		}).getNumberProfile('97455500007@c.us');
		expect(missing.picture.status).toBe('hidden');

		const broken = await provider({
			profilePictureUrl: jest.fn(async () => Promise.reject(serverRefusal(500, 'internal-server-error'))),
			fetchStatus: jest.fn(async () => Promise.reject(new Error('timeout'))),
			getBusinessProfile: jest.fn(async () => Promise.reject(new Error('boom'))),
		}).getNumberProfile('97455500007@c.us');
		expect(broken.picture.status).toBe('error');
		expect(broken.about.status).toBe('error');
		expect(broken.business.status).toBe('error');
	});
});

describe('Baileys WhatsApp contact list writes', () => {
	it('saves through the app-state contact action and asks the phone address book too', async () => {
		const addOrEditContact = jest.fn(async () => undefined);
		const instance = provider({ addOrEditContact });
		instance.contacts.set('97455500008@c.us', {
			id: '97455500008@c.us',
			lid: '123456789@lid',
		});
		await instance.saveContactToWhatsApp('97455500008@c.us', { fullName: 'Ali Hassan' });
		expect(addOrEditContact).toHaveBeenCalledWith('97455500008@s.whatsapp.net', {
			fullName: 'Ali Hassan',
			firstName: 'Ali',
			saveOnPrimaryAddressbook: true,
			lidJid: '123456789@lid',
		});
		expect(instance.savedContactName('97455500008@c.us')).toBe('Ali Hassan');
	});

	it('maps LID chats back to their phone number', async () => {
		const addOrEditContact = jest.fn(async () => undefined) as jest.Mock;
		const instance = provider({ addOrEditContact });
		instance.lidToPn.set('555@lid', '97455500009');
		await instance.saveContactToWhatsApp('555@lid', { fullName: 'Mona' });
		expect(addOrEditContact.mock.calls[0][0]).toBe('97455500009@s.whatsapp.net');
		await expect(instance.saveContactToWhatsApp('999@lid', { fullName: 'X' })).rejects.toThrow(
			'No phone number',
		);
	});

	it('surfaces WhatsApp rejections so the caller records a failure', async () => {
		const instance = provider({
			addOrEditContact: jest.fn(async () => Promise.reject(new Error('App state key not present!'))),
		});
		await expect(
			instance.saveContactToWhatsApp('97455500010@c.us', { fullName: 'Nour' }),
		).rejects.toThrow('App state key not present!');
		expect(instance.savedContactName('97455500010@c.us')).toBeNull();
	});

	it('removes through removeContact and reports unsupported libraries', async () => {
		const removeContact = jest.fn(async () => undefined);
		await provider({ removeContact }).removeContactFromWhatsApp('97455500011@c.us');
		expect(removeContact).toHaveBeenCalledWith('97455500011@s.whatsapp.net');
		const error = await provider({})
			.saveContactToWhatsApp('97455500011@c.us', { fullName: 'Z' })
			.catch((e: unknown) => e);
		expect((error as WhatsAppProviderUnavailableError).reason).toBe('unsupported');
	});
});
