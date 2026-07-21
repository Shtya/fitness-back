import { BadRequestException } from '@nestjs/common';
import { WhatsAppConversationsController } from './whatsapp-conversations.controller';

describe('WhatsAppConversationsController', () => {
	function createController() {
		const sync = {
			listConversations: jest.fn().mockResolvedValue({ items: [] }),
			sendText: jest.fn().mockResolvedValue({ ok: true }),
			sendMedia: jest.fn().mockResolvedValue({ ok: true }),
			reactToMessage: jest.fn().mockResolvedValue({ reactions: [] }),
			forwardMessage: jest.fn().mockResolvedValue({ ok: true }),
			starMessage: jest.fn().mockResolvedValue({ ok: true }),
			pinMessage: jest.fn().mockResolvedValue({ ok: true }),
			deleteMessage: jest.fn().mockResolvedValue({ ok: true }),
			getMessageInfo: jest.fn().mockResolvedValue({ status: 'read' }),
			syncConversation: jest.fn(),
		};
		const access = { assertAccountPermission: jest.fn() };
		return {
			controller: new WhatsAppConversationsController(sync as any, access as any),
			sync,
			access,
		};
	}

	it('normalizes conversation pagination query values', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };
		await controller.listConversations({ user }, 'account-1', '2', '75', ' Ahmed ');
		expect(sync.listConversations).toHaveBeenCalledWith(
			user,
			'account-1',
			2,
			75,
			' Ahmed ',
			'all',
			'',
		);
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

	it('dispatches message reactions to the sync service', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };

		await controller.reactToMessage(
			{ user },
			'conversation-1',
			'message-1',
			{ emoji: '👍' },
		);

		expect(sync.reactToMessage).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'message-1',
			'👍',
		);
	});

	it('dispatches forward and message state actions to the sync service', async () => {
		const { controller, sync } = createController();
		const user = { id: 'user-1' };

		await controller.forwardMessage(
			{ user },
			'conversation-1',
			'message-1',
			{ targetConversationId: 'conversation-2' },
		);
		await controller.starMessage(
			{ user },
			'conversation-1',
			'message-1',
			{ enabled: true },
		);
		await controller.pinMessage(
			{ user },
			'conversation-1',
			'message-1',
			{ enabled: true },
		);
		await controller.deleteMessage(
			{ user },
			'conversation-1',
			'message-1',
			{ mode: 'local' },
		);

		expect(sync.forwardMessage).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'message-1',
			'conversation-2',
		);
		expect(sync.starMessage).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'message-1',
			true,
		);
		expect(sync.pinMessage).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'message-1',
			true,
		);
		expect(sync.deleteMessage).toHaveBeenCalledWith(
			user,
			'conversation-1',
			'message-1',
			'local',
		);
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

	it('rejects cleanup attempts outside the current upload directory', async () => {
		const { controller, access } = createController();
		await expect(
			controller.deletePendingUpload(
				{ user: { id: 'user-1' } },
				'account-1',
				{ fileId: '../another-user/private.jpg' },
			),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(access.assertAccountPermission).toHaveBeenCalledWith(
			{ id: 'user-1' },
			'account-1',
			'canUse',
		);
	});
});
