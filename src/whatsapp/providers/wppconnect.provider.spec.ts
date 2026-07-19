import { WppConnectProvider } from './wppconnect.provider';

describe('WppConnectProvider message normalization', () => {
	function providerWithMessages(messages: any[]) {
		const provider = new WppConnectProvider('account-test', {});
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
			count: 100,
			id: 'cursor-1',
			direction: 'before',
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
