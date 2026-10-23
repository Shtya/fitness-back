import { BaileysProvider } from './baileys.provider';

const incoming = (id: string, remoteJid = '201000@s.whatsapp.net', extra: any = {}) => ({
	key: { id, remoteJid, fromMe: false, ...extra },
	message: { conversation: 'hi' },
});

describe('BaileysProvider hold delivery receipts', () => {
	it('sends the receipt normally when the setting is off', async () => {
		const provider = new BaileysProvider('acc-1');
		provider.setDeliveryReceiptHold(() => false);
		await expect((provider as any).shouldSendDeliveryReceipt(incoming('a'))).resolves.toBe(true);
	});

	it('holds chat messages but never statuses or own messages', async () => {
		const provider = new BaileysProvider('acc-1');
		provider.setDeliveryReceiptHold(() => true);
		const gate = (msg: any) => (provider as any).shouldSendDeliveryReceipt(msg);
		await expect(gate(incoming('a'))).resolves.toBe(false);
		await expect(gate(incoming('s', 'status@broadcast'))).resolves.toBe(true);
		await expect(gate({ key: { id: 'm', remoteJid: '201000@s.whatsapp.net', fromMe: true } })).resolves.toBe(true);
	});

	it('releases held receipts as one delivery receipt when replying', async () => {
		const provider = new BaileysProvider('acc-1');
		provider.setDeliveryReceiptHold(() => true);
		await (provider as any).shouldSendDeliveryReceipt(incoming('a'));
		await (provider as any).shouldSendDeliveryReceipt(
			incoming('b', '7766@lid', { remoteJidAlt: '201000@s.whatsapp.net' }),
		);
		const sendReceipts = jest.fn(async () => undefined);
		(provider as any).socket = { sendReceipts };
		(provider as any).state = 'connected';

		await expect(provider.releaseDeliveryReceipts('201000@c.us')).resolves.toBe(2);
		expect(sendReceipts).toHaveBeenCalledWith(
			[
				{ remoteJid: '201000@s.whatsapp.net', id: 'a', participant: undefined, fromMe: false },
				{ remoteJid: '7766@lid', id: 'b', participant: undefined, fromMe: false },
			],
			undefined,
		);
		await expect(provider.releaseDeliveryReceipts('201000@c.us')).resolves.toBe(0);
	});

	it('keeps receipts for later when the socket is offline', async () => {
		const provider = new BaileysProvider('acc-1');
		provider.setDeliveryReceiptHold(() => true);
		await (provider as any).shouldSendDeliveryReceipt(incoming('a'));
		await expect(provider.releaseDeliveryReceipts('201000@c.us')).resolves.toBe(0);
		const sendReceipts = jest.fn(async () => undefined);
		(provider as any).socket = { sendReceipts };
		(provider as any).state = 'connected';
		await expect(provider.releaseDeliveryReceipts('201000@c.us')).resolves.toBe(1);
	});
});
