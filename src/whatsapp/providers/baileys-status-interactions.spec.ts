import { BaileysProvider, routeBaileysReceiptUpdates } from './baileys.provider';

const OWN = '201000000000:7@s.whatsapp.net';

describe('routeBaileysReceiptUpdates', () => {
	it('turns read receipts on our own stories into story views', () => {
		const events = routeBaileysReceiptUpdates(
			[
				{
					key: { remoteJid: 'status@broadcast', id: 'STORY1', fromMe: true },
					receipt: { userJid: '201111111111@s.whatsapp.net', readTimestamp: 1_700_000_000 },
				},
				{
					key: { remoteJid: 'status@broadcast', id: 'STORY1', fromMe: true },
					receipt: { userJid: '12345@lid', readTimestamp: 1_700_000_100 },
				},
			],
			[OWN],
		);
		expect(events).toEqual([
			{
				type: 'status_receipts',
				statusMessageId: 'STORY1',
				receipts: [
					{ participantJid: '201111111111@s.whatsapp.net', readAt: new Date(1_700_000_000_000) },
					{ participantJid: '12345@lid', readAt: new Date(1_700_000_100_000) },
				],
			},
		]);
	});

	it('ignores delivery-only receipts, other people’s stories and our own devices', () => {
		const events = routeBaileysReceiptUpdates(
			[
				{
					key: { remoteJid: 'status@broadcast', id: 'STORY1', fromMe: true },
					receipt: { userJid: '201111111111@s.whatsapp.net', receiptTimestamp: 1_700_000_000 },
				},
				{
					key: { remoteJid: 'status@broadcast', id: 'THEIRS', fromMe: false },
					receipt: { userJid: '201222222222@s.whatsapp.net', readTimestamp: 1_700_000_000 },
				},
				{
					key: { remoteJid: 'status@broadcast', id: 'STORY1', fromMe: true },
					receipt: { userJid: '201000000000:3@s.whatsapp.net', readTimestamp: 1_700_000_000 },
				},
			],
			[OWN],
		);
		expect(events).toEqual([]);
	});

	it('still routes group receipts to message_receipts', () => {
		const events = routeBaileysReceiptUpdates([
			{
				key: { remoteJid: '1203630@g.us', id: 'GROUPMSG', fromMe: true },
				receipt: { userJid: '201111111111@s.whatsapp.net', readTimestamp: 1_700_000_000 },
			},
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'message_receipts',
			providerMessageId: 'GROUPMSG',
			chatId: '1203630@g.us',
		});
	});

	it('tolerates malformed input', () => {
		expect(routeBaileysReceiptUpdates(null as any)).toEqual([]);
		expect(routeBaileysReceiptUpdates([{}, { key: {} }, null])).toEqual([]);
	});
});

describe('BaileysProvider story replies', () => {
	function connectedProvider() {
		const provider = new BaileysProvider('account-story-reply') as any;
		const sendMessage = jest.fn().mockResolvedValue({
			key: { remoteJid: '201111111111@s.whatsapp.net', id: 'REPLY1', fromMe: true },
			message: { extendedTextMessage: { text: 'nice' } },
			messageTimestamp: Math.floor(Date.now() / 1000),
		});
		provider.state = 'connected';
		provider.socket = { sendMessage, user: { id: OWN } };
		return { provider, sendMessage };
	}

	it('quotes the story on status@broadcast so WhatsApp shows a status reply', async () => {
		const { provider, sendMessage } = connectedProvider();
		await provider.sendText('201111111111@c.us', 'nice', {
			statusQuote: {
				statusMessageId: 'STORY9',
				providerStatusId: 'false_status@broadcast_STORY9_201111111111@c.us',
				ownerJid: '201111111111@c.us',
				type: 'image',
				caption: 'Beach',
			},
		});
		expect(sendMessage).toHaveBeenCalledTimes(1);
		const [jid, content, options] = sendMessage.mock.calls[0];
		expect(jid).toBe('201111111111@s.whatsapp.net');
		expect(content).toEqual({ text: 'nice' });
		expect(options.quoted.key).toEqual({
			remoteJid: 'status@broadcast',
			id: 'STORY9',
			fromMe: false,
			participant: '201111111111@s.whatsapp.net',
		});
		expect(options.quoted.message).toEqual({ imageMessage: { caption: 'Beach' } });
	});

	it('prefers the cached story message when the session still has it', async () => {
		const { provider, sendMessage } = connectedProvider();
		const cachedMessage = { extendedTextMessage: { text: 'Hello from my story' } };
		provider.statusRawById.set('false_status@broadcast_STORY10_201111111111@c.us', {
			key: { remoteJid: 'status@broadcast', id: 'STORY10', participant: '201111111111@s.whatsapp.net' },
			message: cachedMessage,
		});
		await provider.sendText('201111111111@c.us', '😂', {
			statusQuote: {
				statusMessageId: 'STORY10',
				providerStatusId: 'false_status@broadcast_STORY10_201111111111@c.us',
				ownerJid: '201111111111@c.us',
				type: 'text',
			},
		});
		expect(sendMessage.mock.calls[0][2].quoted.message).toBe(cachedMessage);
	});
});
