import {
	buildWhatsAppGroupReceiptView,
	whatsAppReceiptBaseKey,
} from './whatsapp-group-receipts';

const LID_TO_PHONE: Record<string, string> = { '555@lid': '201000000003' };

function identityOf(key: string) {
	const base = whatsAppReceiptBaseKey(key);
	if (LID_TO_PHONE[base]) return `p:${LID_TO_PHONE[base]}`;
	if (base.endsWith('@lid')) return `k:${base}`;
	return `p:${base.split('@')[0]}`;
}

describe('buildWhatsAppGroupReceiptView', () => {
	const members = [
		{ key: '201000000001@c.us', name: 'Self' },
		{ key: '201000000002@c.us', name: 'Mona' },
		{ key: '201000000003@c.us', name: 'Omar' },
		{ key: '201000000004@c.us', name: 'Sara' },
	];

	it('splits members into read, delivered and remaining, excluding self', () => {
		const view = buildWhatsAppGroupReceiptView({
			members,
			receipts: [
				{ participantKey: '201000000002:3@s.whatsapp.net', deliveredAt: new Date(1000) },
				{ participantKey: '201000000002@s.whatsapp.net', readAt: new Date(5000) },
				{ participantKey: '555@lid', deliveredAt: new Date(2000) },
			],
			selfIdentities: ['p:201000000001'],
			identityOf,
		});
		expect(view.total).toBe(3);
		expect(view.tracked).toBe(true);
		expect(view.read.map((entry) => entry.name)).toEqual(['Mona']);
		expect(view.read[0].deliveredAt).toEqual(new Date(1000));
		expect(view.delivered.map((entry) => entry.name)).toEqual(['Omar']);
		expect(view.remaining.map((entry) => entry.name)).toEqual(['Sara']);
	});

	it('keeps the earliest timestamp and treats played as read', () => {
		const view = buildWhatsAppGroupReceiptView({
			members,
			receipts: [
				{ participantKey: '201000000004@c.us', playedAt: new Date(9000) },
				{ participantKey: '201000000004@c.us', deliveredAt: new Date(4000) },
				{ participantKey: '201000000004@c.us', deliveredAt: new Date(3000) },
			],
			selfIdentities: ['p:201000000001'],
			identityOf,
		});
		expect(view.read).toHaveLength(1);
		expect(view.read[0].readAt).toEqual(new Date(9000));
		expect(view.read[0].deliveredAt).toEqual(new Date(3000));
	});

	it('reports untracked messages and adds receipt senders missing from the member list', () => {
		const untracked = buildWhatsAppGroupReceiptView({
			members,
			receipts: [],
			selfIdentities: ['p:201000000001'],
			identityOf,
		});
		expect(untracked.tracked).toBe(false);
		expect(untracked.remaining).toHaveLength(3);

		const extra = buildWhatsAppGroupReceiptView({
			members: [],
			receipts: [{ participantKey: '999@lid', readAt: new Date(1) }],
			selfIdentities: [],
			identityOf,
			describe: () => ({ name: 'New member' }),
		});
		expect(extra.read.map((entry) => entry.name)).toEqual(['New member']);
	});
});
