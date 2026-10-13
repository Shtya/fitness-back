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

	it('hides the quote preview of a reply to view-once media', () => {
		const [message] = prepareMessagesForClient([
			{
				id: 'm5',
				text: 'wow',
				raw: {
					message: {
						extendedTextMessage: {
							text: 'wow',
							contextInfo: {
								stanzaId: 'Q1',
								quotedMessage: { imageMessage: { viewOnce: true, caption: 'private', jpegThumbnail: 'abc' } },
							},
						},
					},
				},
				replyTo: { id: 'q1', type: 'image', text: 'private', previewDataUrl: 'data:image/jpeg;base64,abc' },
			},
		]) as any[];
		expect(message.isViewOnce).toBeUndefined();
		expect(message.text).toBe('wow');
		expect(message.replyTo).toMatchObject({ id: 'q1', type: 'image', isViewOnce: true, text: null, previewDataUrl: null });
		expect(JSON.stringify(message)).not.toContain('private');
	});

	it('hides the quote preview when only the quoted row is known to be view-once', () => {
		const [message] = prepareMessagesForClient([
			{ id: 'm6', raw: null, replyTo: { id: 'q2', type: 'view_once', text: 'x', previewDataUrl: 'y' } },
		]) as any[];
		expect(message.replyTo).toMatchObject({ isViewOnce: true, text: null, previewDataUrl: null });
	});

	it('keeps ordinary reply quotes intact', () => {
		const replyTo = { id: 'q3', type: 'image', text: 'public', previewDataUrl: 'data:image/jpeg;base64,abc' };
		const [message] = prepareMessagesForClient([{ id: 'm7', raw: null, replyTo }]) as any[];
		expect(message.replyTo).toBe(replyTo);
	});

	it('flags key-only view-once stubs from linked devices', () => {
		const [message] = prepareMessagesForClient([
			{ id: 'm4', raw: { protocol: 'baileys', id: 'X', isViewOnce: true } },
		]) as any[];
		expect(message.isViewOnce).toBe(true);
	});
});
