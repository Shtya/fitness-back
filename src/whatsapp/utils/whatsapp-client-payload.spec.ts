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
	});
});
