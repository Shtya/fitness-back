import { HeldDeliveryReceipts } from './whatsapp-held-receipts';

const normalize = (jid: string) =>
	jid.endsWith('@s.whatsapp.net') ? [jid, jid.replace('@s.whatsapp.net', '@c.us')] : [jid];

describe('HeldDeliveryReceipts', () => {
	it('keeps held keys per chat and hands them back once', () => {
		const held = new HeldDeliveryReceipts(normalize);
		held.hold({ remoteJid: '2010@s.whatsapp.net', id: 'a' });
		held.hold({ remoteJid: '2010@s.whatsapp.net', id: 'b' });
		held.hold({ remoteJid: '2099@s.whatsapp.net', id: 'c' });
		expect(held.take(['2010@c.us']).map(key => key.id)).toEqual(['a', 'b']);
		expect(held.take(['2010@c.us'])).toEqual([]);
		expect(held.count(['2099@s.whatsapp.net'])).toBe(1);
	});

	it('finds a chat by its @lid or phone alias', () => {
		const held = new HeldDeliveryReceipts(normalize);
		held.hold({ remoteJid: '7766@lid', id: 'x' }, ['2010@s.whatsapp.net']);
		expect(held.take(['2010@c.us'])).toEqual([{ remoteJid: '7766@lid', id: 'x', participant: undefined }]);
	});

	it('keeps group participants and stays bounded', () => {
		const held = new HeldDeliveryReceipts(normalize, 2, 1);
		held.hold({ remoteJid: 'g1@g.us', id: '1', participant: 'p1@lid' });
		held.hold({ remoteJid: 'g1@g.us', id: '2', participant: 'p2@lid' });
		held.hold({ remoteJid: 'g1@g.us', id: '3', participant: 'p1@lid' });
		expect(held.count(['g1@g.us'])).toBe(2);
		held.hold({ remoteJid: 'g2@g.us', id: '9' });
		expect(held.count(['g1@g.us'])).toBe(0);
		expect(held.take(['g2@g.us'])).toHaveLength(1);
	});
});
