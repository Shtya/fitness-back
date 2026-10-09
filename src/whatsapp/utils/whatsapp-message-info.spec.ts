import { buildWhatsAppMessageAckInfo } from './whatsapp-message-info';

describe('buildWhatsAppMessageAckInfo', () => {
	it('maps outbound read status to delivery + read checks', () => {
		const info = buildWhatsAppMessageAckInfo({
			status: 'read',
			fromMe: true,
			statusUpdatedAt: '2026-10-09T08:00:00.000Z',
		});
		expect(info.delivered).toBe(true);
		expect(info.read).toBe(true);
		expect(info.played).toBe(false);
		expect(info.deliveryRemaining).toBe(0);
		expect(info.readRemaining).toBe(0);
		expect(info.source).toBe('status');
	});

	it('does not invent outbound receipts for inbound messages', () => {
		const info = buildWhatsAppMessageAckInfo({
			status: 'delivered',
			fromMe: false,
		});
		expect(info.delivered).toBe(false);
		expect(info.read).toBe(false);
		expect(info.deliveryRemaining).toBeNull();
		expect(info.source).toBe('none');
	});

	it('prefers provider acknowledgement counts when present', () => {
		const info = buildWhatsAppMessageAckInfo({
			status: 'sent',
			fromMe: true,
			acknowledgements: {
				deliveryRemaining: 0,
				readRemaining: 1,
				playedRemaining: 1,
			},
		});
		expect(info.source).toBe('provider');
		expect(info.delivered).toBe(true);
		expect(info.read).toBe(false);
	});
});
