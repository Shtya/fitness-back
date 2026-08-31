import { isStatusMessage, WppConnectProvider } from './wppconnect.provider';
import * as voiceOgg from '../utils/whatsapp-voice-ogg';

describe('WppConnectProvider message normalization', () => {
	function providerWithMessages(messages: any[]) {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).state = 'connected';
		(provider as any).client = {
			getMessages: jest.fn().mockResolvedValue(messages),
		};
		return provider;
	}

	it('normalizes chat messages and stable identifiers', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'message-1', fromMe: false },
				from: { _serialized: '201000000000@c.us' },
				type: 'chat',
				body: 'hello',
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');

		expect(message).toMatchObject({
			providerMessageId: 'message-1',
			chatId: '201000000000@c.us',
			type: 'text',
			text: 'hello',
			fromMe: false,
			timestampReliable: true,
		});
	});

	it('normalizes the provider quotedMsgId used by incoming replies', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'message-2', fromMe: false },
				from: '201000000000@c.us',
				type: 'chat',
				body: 'reply',
				quotedMsgId: 'message-1',
				timestamp: 1_700_000_001,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');
		expect(message.quotedProviderMessageId).toBe('message-1');
	});

	it('sends and normalizes message reactions', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendReactionToMessage = jest.fn().mockResolvedValue({ ok: true });
		(provider as any).client = {
			sendReactionToMessage,
			getReactions: jest.fn().mockResolvedValue({
				reactionByMe: {
					reactionText: '❤️',
					senderUserJid: 'self@c.us',
					timestamp: 1_700_000_000,
				},
				reactions: [],
			}),
		};

		await provider.sendReaction('message-1', '❤️');
		const reactions = await provider.getReactions('message-1');

		expect(sendReactionToMessage).toHaveBeenCalledWith('message-1', '❤️');
		expect(reactions).toEqual([
			expect.objectContaining({ actorKey: 'me', emoji: '❤️' }),
		]);
	});

	it('forwards, deletes and stars messages with provider-safe arguments', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const forwardMessagesV2 = jest.fn().mockResolvedValue([{ id: 'forwarded-1' }]);
		const deleteMessage = jest.fn().mockResolvedValue(true);
		const starMessage = jest.fn().mockResolvedValue(1);
		(provider as any).client = { forwardMessagesV2, deleteMessage, starMessage };

		await provider.forwardMessage('target@c.us', 'message-1');
		await provider.deleteMessage('source@c.us', 'message-1', 'everyone');
		await provider.deleteMessage('source@c.us', 'message-1', 'local');
		await provider.starMessage('message-1', true);

		expect(forwardMessagesV2).toHaveBeenCalledWith('target@c.us', 'message-1', {
			displayCaptionText: true,
		});
		expect(deleteMessage).toHaveBeenNthCalledWith(
			1,
			'source@c.us',
			'message-1',
			false,
			true,
		);
		expect(deleteMessage).toHaveBeenNthCalledWith(
			2,
			'source@c.us',
			'message-1',
			true,
			true,
		);
		expect(starMessage).toHaveBeenCalledWith('message-1', true);
	});

	it('uses the page API for message pin and acknowledgement info', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const evaluate = jest
			.fn()
			.mockResolvedValueOnce({ pinned: true })
			.mockResolvedValueOnce({ ack: 3, readRemaining: 0 });
		(provider as any).client = {
			page: { evaluate },
			getMessageById: jest.fn().mockResolvedValue({
				id: { _serialized: 'message-1', fromMe: true },
				type: 'chat',
				timestamp: 1_700_000_000,
				ack: 3,
			}),
		};

		await provider.pinMessage('message-1', true);
		const info = await provider.getMessageInfo('message-1');

		expect(evaluate).toHaveBeenNthCalledWith(
			1,
			expect.any(Function),
			{ messageId: 'message-1', shouldPin: true },
		);
		expect(evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), 'message-1');
		expect(info).toMatchObject({
			message: { id: 'message-1', fromMe: true, ack: 3 },
			acknowledgements: { readRemaining: 0 },
		});
	});

	it('recognizes incoming status messages as story updates', () => {
		expect(
			isStatusMessage({
				isStatusV3: true,
				id: { remote: 'status@broadcast' },
			}),
		).toBe(true);
		expect(isStatusMessage({ from: '201000000000@c.us' })).toBe(false);
	});

	it('normalizes PTT to audio and preserves provider duration as a fallback filename', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'voice-1' },
				from: '201000000000@c.us',
				type: 'ptt',
				mimetype: 'audio/ogg; codecs=opus',
				duration: 12.4,
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');

		expect(message.type).toBe('audio');
		expect(message.attachments).toEqual([
			expect.objectContaining({
				type: 'audio',
				mimeType: 'audio/ogg; codecs=opus',
				fileName: 'voice-12s.ogg',
			}),
		]);
	});

	it('does not expose large base64 media payloads as message text', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'image-1' },
				from: '201000000000@c.us',
				type: 'image',
				body: 'data:image/jpeg;base64,' + 'a'.repeat(500),
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');
		expect(message.text).toBeNull();
	});

	it('passes bounded history options to the WPP client', async () => {
		const provider = providerWithMessages([]);
		await provider.getMessages('chat@g.us', { limit: 500, before: 'cursor-1' });
		expect((provider as any).client.getMessages).toHaveBeenCalledWith('chat@g.us', {
			count: 200,
			id: 'cursor-1',
			direction: 'before',
		});
	});

	it('uses listChats without falling back to deprecated getAllChats', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const listChats = jest
			.fn()
			.mockResolvedValue([{ id: { _serialized: '201000000000@c.us' } }]);
		const getAllChats = jest.fn();
		(provider as any).state = 'connected';
		(provider as any).client = { listChats, getAllChats };

		await expect(provider.getChats(50)).resolves.toHaveLength(1);
		expect(listChats).toHaveBeenCalledWith({ ignoreGroupMetadata: true });
		expect(getAllChats).not.toHaveBeenCalled();
	});

	it('keeps the newest chats when the store returns more than the limit', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const chat = (id: string, t: number, pin = false) => ({
			id: { _serialized: id },
			t,
			pin,
		});
		// WPP.chat.list() hands back ChatStore insertion order, which buries recent
		// direct chats behind whatever groups happened to hydrate first.
		const listChats = jest
			.fn()
			.mockResolvedValue([
				chat('group-old@g.us', 1_700_000_000),
				chat('group-older@g.us', 1_600_000_000),
				chat('recent@c.us', 1_750_000_000),
				chat('pinned@c.us', 1_500_000_000, true),
			]);
		(provider as any).state = 'connected';
		(provider as any).client = { listChats };

		const chats = await provider.getChats(2);
		expect(chats.map((item: any) => item.id._serialized)).toEqual([
			'pinned@c.us',
			'recent@c.us',
		]);
	});

	it('marks the session broken on detached Frame errors', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).state = 'connected';
		(provider as any).client = {
			getMessages: jest
				.fn()
				.mockRejectedValue(new Error("Attempted to use detached Frame 'ABC'")),
			close: jest.fn().mockResolvedValue(undefined),
		};

		await expect(provider.getMessages('chat@c.us')).rejects.toThrow(/session died/i);
		expect(provider.getState()).toBe('error');
	});

	it('accepts a new QR when the previously connected session is no longer authenticated', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).state = 'connected';
		(provider as any).client = {
			isAuthenticated: jest.fn().mockResolvedValue(false),
		};

		await (provider as any).publishQr('data:image/png;base64,new-qr');

		expect(provider.getState()).toBe('qr_pending');
		expect(provider.getQr()).toBe('data:image/png;base64,new-qr');
	});

	it('marks connected instead of qr_pending when authenticated during restore', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).state = 'connecting';
		(provider as any).client = {
			isAuthenticated: jest.fn().mockResolvedValue(true),
			getHostDevice: jest.fn().mockResolvedValue({ wid: { user: '201000000000' } }),
		};

		await (provider as any).publishQr('data:image/png;base64,spurious-qr');

		expect(provider.getState()).toBe('connected');
		expect(provider.getQr()).toBeNull();
	});

	it('resolves LID chats to their saved contact name and phone number', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).client = {
			getPnLidEntry: jest.fn().mockResolvedValue({
				phoneNumber: { _serialized: '201000000000@c.us' },
				contact: { name: 'Ahmed', pushname: 'A' },
			}),
		};

		await expect(provider.resolveContactIdentity('96547291279610@lid')).resolves.toEqual({
			phoneNumber: '201000000000',
			name: 'Ahmed',
		});
	});

	it('passes quoted message ids when sending media replies', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendFile = jest.fn().mockResolvedValue({ id: 'provider-media-1' });
		(provider as any).client = { sendFile };

		await provider.sendMedia('201000000000@c.us', 'C:\\test\\photo.jpg', {
			fileName: 'photo.jpg',
			caption: 'reply',
			quotedProviderMessageId: 'quoted-message-1',
		});

		expect(sendFile).toHaveBeenCalledWith('201000000000@c.us', 'C:\\test\\photo.jpg', {
			filename: 'photo.jpg',
			caption: 'reply',
			quotedMsg: 'quoted-message-1',
			waitForAck: true,
		});
	});

	it('sends voice recordings with a valid data URL MIME type', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendPttFromBase64 = jest.fn().mockResolvedValue({ id: 'provider-voice-1' });
		const readFile = jest
			.spyOn(require('fs').promises, 'readFile')
			.mockResolvedValue(Buffer.from('voice-data'));
		const cleanup = jest.fn().mockResolvedValue(undefined);
		const ensureOgg = jest
			.spyOn(voiceOgg, 'ensureWhatsAppVoiceOgg')
			.mockResolvedValue({
				filePath: 'C:\\test\\voice-converted.ogg',
				mimeType: voiceOgg.WHATSAPP_VOICE_MIME,
				fileName: 'voice.ogg',
				cleanup,
			});
		(provider as any).client = { sendPttFromBase64 };

		let ensureOggCalls = 0;
		try {
			await provider.sendMedia('201000000000@c.us', 'C:\\test\\voice.webm', {
				fileName: 'voice.webm',
				isVoice: true,
				mimeType: 'audio/webm; codecs=opus',
			});
		} finally {
			// mockRestore() also clears call history, so snapshot it first.
			ensureOggCalls = ensureOgg.mock.calls.length;
			readFile.mockRestore();
			ensureOgg.mockRestore();
		}

		expect(ensureOggCalls).toBe(1);
		expect(cleanup).toHaveBeenCalledTimes(1);

		expect(sendPttFromBase64).toHaveBeenCalledWith(
			'201000000000@c.us',
			expect.stringMatching(/^data:audio\/ogg;codecs=opus;base64,/),
			'voice.ogg',
			'',
			undefined,
			undefined,
			true,
		);
	});

	it('retries sendText against a resolved lid when c.us fails', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendText = jest
			.fn()
			.mockRejectedValueOnce(new Error('No LID for user'))
			.mockResolvedValueOnce({ id: { _serialized: 'true_123@lid_ABC' } });
		const getPnLidEntry = jest.fn().mockResolvedValue({
			lid: { _serialized: '123@lid' },
			phoneNumber: '201000000000',
		});
		(provider as any).client = { sendText, getPnLidEntry };

		const result = await provider.sendText('201000000000@c.us', 'hello');
		expect(getPnLidEntry).toHaveBeenCalled();
		expect(sendText).toHaveBeenCalled();
		expect(result?.id?._serialized || result?.id).toBeTruthy();
	});
});

describe('WppConnectProvider session invalidation', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	function connectedProvider(client: any) {
		const provider = new WppConnectProvider('account-test', {});
		const events: any[] = [];
		provider.onEvent(event => void events.push(event));
		(provider as any).client = client;
		(provider as any).state = 'connecting';
		(provider as any).everConnected = true;
		return { provider, events };
	}

	async function runPendingCheck() {
		await jest.advanceTimersByTimeAsync(20_000);
	}

	it('wipes the session when the page stays unpaired', async () => {
		const { provider, events } = connectedProvider({
			isAuthenticated: jest.fn().mockResolvedValue(false),
			getConnectionState: jest.fn().mockResolvedValue('UNPAIRED'),
			close: jest.fn().mockResolvedValue(undefined),
		});

		(provider as any).scheduleSessionInvalidCheck('unpaired');
		await runPendingCheck();

		expect(events.map(event => event.type)).toContain('session_invalid');
	});

	it('keeps the session when the page re-authenticates after the state blip', async () => {
		const { provider, events } = connectedProvider({
			isAuthenticated: jest.fn().mockResolvedValue(true),
			getConnectionState: jest.fn().mockResolvedValue('CONNECTED'),
			close: jest.fn().mockResolvedValue(undefined),
		});

		(provider as any).scheduleSessionInvalidCheck('unpaired');
		await runPendingCheck();

		expect(events.map(event => event.type)).not.toContain('session_invalid');
	});

	it('never wipes the session while the provider is shutting down', async () => {
		const { provider, events } = connectedProvider({
			isAuthenticated: jest.fn().mockResolvedValue(false),
			getConnectionState: jest.fn().mockResolvedValue('UNPAIRED'),
			close: jest.fn().mockResolvedValue(undefined),
		});

		(provider as any).scheduleSessionInvalidCheck('unpaired');
		await provider.disconnect();
		await runPendingCheck();

		expect(events.map(event => event.type)).not.toContain('session_invalid');
	});

	it('does not trust a dead page as proof the pairing is gone', async () => {
		const { provider, events } = connectedProvider({
			isAuthenticated: jest.fn().mockRejectedValue(new Error('Target closed')),
			getConnectionState: jest.fn().mockRejectedValue(new Error('Target closed')),
			close: jest.fn().mockResolvedValue(undefined),
		});

		(provider as any).scheduleSessionInvalidCheck('unpaired');
		await runPendingCheck();

		expect(events.map(event => event.type)).not.toContain('session_invalid');
	});

	it('keeps the profile once WhatsApp Web offers a QR to scan', async () => {
		const { provider, events } = connectedProvider({
			isAuthenticated: jest.fn().mockResolvedValue(false),
			getConnectionState: jest.fn().mockResolvedValue('UNPAIRED'),
			close: jest.fn().mockResolvedValue(undefined),
		});

		(provider as any).scheduleSessionInvalidCheck('unpaired');
		await (provider as any).publishQr('data:image/png;base64,QR');
		await runPendingCheck();

		expect(events.map(event => event.type)).toContain('qr');
		expect(events.map(event => event.type)).not.toContain('session_invalid');
		expect(provider.getState()).toBe('qr_pending');
	});
});
