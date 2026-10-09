import {
	buildInboundSenderReceiptView,
	buildWhatsAppMessageAckInfo,
} from './whatsapp-message-info';

describe('buildInboundSenderReceiptView', () => {
	it('maps offline→delivered as grey ticks for the sender', () => {
		const view = buildInboundSenderReceiptView({
			sentAt: '2026-10-09T08:00:00.000Z',
			receivedAt: '2026-10-09T10:00:00.000Z',
			stillUnreadLocally: true,
			readReceiptsEnabled: true,
		});
		expect(view.sent).toBe(true);
		expect(view.delivered).toBe(true);
		expect(view.read).toBe(false);
		expect(view.status).toBe('delivered');
	});

	it('marks read (blue) once we cleared unread and receipts are on', () => {
		const view = buildInboundSenderReceiptView({
			sentAt: '2026-10-09T08:00:00.000Z',
			receivedAt: '2026-10-09T10:00:00.000Z',
			stillUnreadLocally: false,
			readReceiptsEnabled: true,
		});
		expect(view.read).toBe(true);
		expect(view.status).toBe('read');
	});

	it('keeps delivered (grey) when read receipts are disabled', () => {
		const view = buildInboundSenderReceiptView({
			sentAt: '2026-10-09T08:00:00.000Z',
			receivedAt: '2026-10-09T10:00:00.000Z',
			stillUnreadLocally: false,
			readReceiptsEnabled: false,
		});
		expect(view.read).toBe(false);
		expect(view.status).toBe('delivered');
	});
});

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
