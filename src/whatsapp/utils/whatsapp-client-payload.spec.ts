import { prepareMessagesForClient, toWhatsAppClientUser } from './whatsapp-client-payload';

describe('whatsapp client payload', () => {
	const fullUser = {
		id: 'u1',
		name: 'Coach',
		role: 'coach',
		email: 'coach@example.com',
		password: '$2b$12$hash',
		resetPasswordToken: '123456',
		resetPasswordExpires: new Date(),
	};

	it('projects a user to a display summary', () => {
		expect(toWhatsAppClientUser(fullUser)).toEqual({ id: 'u1', name: 'Coach', role: 'coach' });
		expect(toWhatsAppClientUser(null)).toBeNull();
		expect(toWhatsAppClientUser({})).toBeNull();
	});

	it('strips user secrets and media crypto from outbound messages', () => {
		const [message] = prepareMessagesForClient([
			{
				id: 'm1',
				senderUser: fullUser,
				raw: { message: { imageMessage: { mediaKey: 'secret', caption: 'hi' } } },
				attachments: [],
			},
		]) as any[];
		expect(message.senderUser).toEqual({ id: 'u1', name: 'Coach', role: 'coach' });
		expect(JSON.stringify(message)).not.toContain('password');
		expect(JSON.stringify(message)).not.toContain('resetPasswordToken');
		expect(message.raw.message.imageMessage.mediaKey).toBeUndefined();
		expect(message.raw.message.imageMessage.caption).toBe('hi');
	});

	it('leaves messages without a sender relation untouched', () => {
		const [message] = prepareMessagesForClient([{ id: 'm2', raw: null }]) as any[];
		expect('senderUser' in message).toBe(false);
		expect(message.isViewOnce).toBeUndefined();
	});

	it('flags view-once messages and drops their caption and previews', () => {
		const attachment = { id: 'a1', type: 'image', previewDataUrl: 'data:image/jpeg;base64,x' };
		const [message] = prepareMessagesForClient([
			{
				id: 'm3',
				text: 'secret caption',
				raw: {
					message: { imageMessage: { viewOnce: true, jpegThumbnail: 'x', caption: 'secret caption' } },
				},
				attachments: [attachment],
			},
		]) as any[];
		expect(message.isViewOnce).toBe(true);
		expect(message.text).toBeNull();
		expect(message.raw.message.imageMessage.jpegThumbnail).toBeUndefined();
		expect(JSON.stringify(message)).not.toContain('secret caption');
		expect(message.attachments[0]).toEqual({ id: 'a1', type: 'image', viewOnce: true });
		expect(attachment.previewDataUrl).toBeDefined();
	});

	it('flags key-only view-once stubs from linked devices', () => {
		const [message] = prepareMessagesForClient([
			{ id: 'm4', raw: { protocol: 'baileys', id: 'X', isViewOnce: true } },
		]) as any[];
		expect(message.isViewOnce).toBe(true);
	});
});
