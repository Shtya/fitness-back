import { BadRequestException } from '@nestjs/common';
import { WhatsAppConversationsController } from './whatsapp-conversations.controller';

describe('WhatsAppConversationsController', () => {
	function createController() {
		const sync = {
			listConversations: jest.fn().mockResolvedValue({ items: [] }),
			sendText: jest.fn().mockResolvedValue({ ok: true }),
			sendMedia: jest.fn().mockResolvedValue({ ok: true }),
			syncConversation: jest.fn(),
		};
		const access = { assertAccountPermission: jest.fn() };
		return {
			controller: new WhatsAppConversationsController(sync as any, access as any),
			sync,
		};
	}

	it('normalizes conversation pagination query values', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };
		await controller.listConversations({ user }, 'account-1', '2', '75');
		expect(sync.listConversations).toHaveBeenCalledWith(user, 'account-1', 2, 75);
	});

	it('trims and dispatches text without invoking media send', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };
		await controller.send(
			{ user },
			'conversation-1',
			{
				type: 'text',
				text: '  hello  ',
				quotedProviderMessageId: 'quoted-1',
			} as any,
		);
		expect(sync.sendText).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'hello',
			'quoted-1',
			undefined,
		);
		expect(sync.sendMedia).not.toHaveBeenCalled();
	});

	it('rejects blank text before reaching the provider', () => {
		const { controller, sync } = createController();
		expect(() =>
			controller.send(
				{ user: { id: 'user-1' } },
				'conversation-1',
				{ type: 'text', text: '   ' } as any,
			),
		).toThrow(BadRequestException);
		expect(sync.sendText).not.toHaveBeenCalled();
	});

	it('rejects media requests without an uploaded file id', () => {
		const { controller, sync } = createController();
		expect(() =>
			controller.send(
				{ user: { id: 'user-1' } },
				'conversation-1',
				{ type: 'image' } as any,
			),
		).toThrow(BadRequestException);
		expect(sync.sendMedia).not.toHaveBeenCalled();
	});

	it('passes media type, caption and quote to the service', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };
		await controller.send(
			{ user },
			'conversation-1',
			{
				type: 'image',
				fileId: 'outgoing/account-1/user-1/file.jpg',
				caption: 'caption',
				quotedProviderMessageId: 'quoted-1',
			} as any,
		);
		expect(sync.sendMedia).toHaveBeenCalledWith(user, 'conversation-1', {
			type: 'image',
			fileId: 'outgoing/account-1/user-1/file.jpg',
			caption: 'caption',
			quotedProviderMessageId: 'quoted-1',
			clientMessageId: undefined,
		});
	});
});
