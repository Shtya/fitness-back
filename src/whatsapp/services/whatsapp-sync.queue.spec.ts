import { WhatsAppSyncService } from './whatsapp-sync.service';
import { BadRequestException } from '@nestjs/common';

describe('WhatsAppSyncService queue and realtime coalescing', () => {
	function createService() {
		const conversationRepo = {
			findOne: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
		};
		const accountRepo = {
			findOne: jest.fn().mockResolvedValue({ id: 'account-1', initialHydratedAt: null }),
			update: jest.fn().mockResolvedValue(undefined),
		};
		const access: any = {
			getAccountAccess: jest.fn(),
			canSeeAllConversations: jest.fn().mockReturnValue(true),
			notificationRecipientIds: jest.fn().mockResolvedValue([]),
		};
		access.assertConversationVisible = jest.fn(
			async (user: any, conversationId: string) => {
				const conversation = await conversationRepo.findOne({
					where: { id: conversationId },
				});
				const accountAccess = await access.getAccountAccess(
					user,
					conversation?.accountId,
				);
				return { conversation, accountAccess, canSeeAll: true };
			},
		);
		const providers = {
			getProvider: jest.fn(),
		};
		const audit = {
			write: jest.fn().mockResolvedValue(undefined),
		};
		const gateway = {
			emitAccountEvent: jest.fn(),
			emitConversationEvent: jest.fn(),
		};
		const service = new WhatsAppSyncService(
			accountRepo as any,
			{} as any,
			conversationRepo as any,
			{} as any, // noteRepo
			{} as any,
			{} as any, // participantRepo
			{} as any, // messageRepo
			{} as any, // attachmentRepo
			{} as any, // reactionRepo
			access as any,
			providers as any,
			gateway as any,
			audit as any,
			{} as any, // notifications
			{ syncFromProvider: jest.fn().mockResolvedValue({ synced: 0 }) } as any, // statusService
			{
				applyPresenceEvent: jest.fn(),
				subscribeRecentDirectChats: jest.fn().mockResolvedValue({ ok: true }),
				clearAccount: jest.fn(),
				listOnline: jest.fn().mockReturnValue({ items: [] }),
			} as any, // contactPresence
			{} as any, // preferenceRepo
		);
		return { service, gateway, conversationRepo, access, providers, audit };
	}

	it('does not let one conversation debounce another conversation update', () => {
		jest.useFakeTimers();
		const { service, gateway } = createService();

		(service as any).scheduleConversationUpdated('account-1', {
			conversationId: 'conversation-1',
		});
		(service as any).scheduleConversationUpdated('account-1', {
			conversationId: 'conversation-2',
		});
		jest.advanceTimersByTime(1200);

		expect(gateway.emitAccountEvent).toHaveBeenCalledTimes(2);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(
			'account-1',
			'conversation_updated',
			{ conversationId: 'conversation-1' },
		);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(
			'account-1',
			'conversation_updated',
			{ conversationId: 'conversation-2' },
		);
		jest.useRealTimers();
	});

	it('retries transient persistence failures and keeps the queue alive', async () => {
		const { service } = createService();
		const task = jest
			.fn()
			.mockRejectedValueOnce(new Error('temporary database failure'))
			.mockRejectedValueOnce(new Error('temporary database failure'))
			.mockResolvedValue(undefined);

		(service as any).enqueuePersist(task, 'test-message');
		await (service as any).persistQueue;

		expect(task).toHaveBeenCalledTimes(3);
	});

	it('rejects an outgoing upload owned by another account or user', async () => {
		const { service } = createService();
		(service as any).assertConversationVisible = jest.fn().mockResolvedValue({
			conversation: {
				id: 'conversation-1',
				accountId: 'account-a',
				providerChatId: '201000000000@c.us',
			},
			accountAccess: { canUse: true },
		});

		await expect(
			service.sendMedia(
				{ id: 'user-a' } as any,
				'conversation-1',
				{
					type: 'image',
					fileId: 'outgoing/account-b/user-b/stolen.jpg',
				},
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('coalesces concurrent sends with the same client message id', async () => {
		const { service } = createService();
		const operation = jest.fn().mockResolvedValue({ ok: true, id: 'provider-1' });

		const first = (service as any).runIdempotentSend(
			'user-1',
			'conversation-1',
			'client-message-1',
			operation,
		);
		const second = (service as any).runIdempotentSend(
			'user-1',
			'conversation-1',
			'client-message-1',
			operation,
		);

		await expect(first).resolves.toEqual({ ok: true, id: 'provider-1' });
		await expect(second).resolves.toEqual({ ok: true, id: 'provider-1' });
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it('does not send a read receipt on open when mode is on_reply', async () => {
		const { service, conversationRepo, access, providers } = createService();
		const markChatRead = jest.fn();
		conversationRepo.findOne.mockResolvedValue({
			id: 'conversation-1',
			accountId: 'account-1',
			providerChatId: '201000000000@c.us',
			assignedUserId: null,
		});
		access.getAccountAccess.mockResolvedValue({
			account: {
				id: 'account-1',
				ownerAdminId: 'user-1',
				providerCapabilities: {
					'privacy.readReceiptMode': 'on_reply',
				},
			},
			canView: true,
			canUse: true,
			canManage: true,
			canAssign: true,
		});
		providers.getProvider.mockReturnValue({
			getState: () => 'connected',
			markChatRead,
		});

		await service.markConversationRead({ id: 'user-1' } as any, 'conversation-1');

		expect(markChatRead).not.toHaveBeenCalled();
		expect(conversationRepo.update).toHaveBeenCalledWith('conversation-1', {
			unreadCount: 0,
		});
	});

	it('sends the read receipt after replying when mode is on_reply', async () => {
		const { service, conversationRepo } = createService();
		const provider = { markChatRead: jest.fn().mockResolvedValue(undefined) };

		await (service as any).markReadAfterReply(
			{
				id: 'conversation-1',
				accountId: 'account-1',
				providerChatId: '201000000000@c.us',
			},
			{
				providerCapabilities: {
					'privacy.readReceiptMode': 'on_reply',
				},
			},
			provider,
			'user-1',
		);

		expect(provider.markChatRead).toHaveBeenCalledWith('201000000000@c.us');
		expect(conversationRepo.update).toHaveBeenCalledWith('conversation-1', {
			unreadCount: 0,
		});
	});

	it('serializes inbox sync jobs for the same account', async () => {
		const { service } = createService();
		const order: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const first = (service as any).enqueueInboxSync(
			'account-1',
			() =>
				new Promise((resolve) => {
					order.push('start-1');
					releaseFirst = () => {
						order.push('end-1');
						resolve('one');
					};
				}),
		);
		const second = (service as any).enqueueInboxSync('account-1', async () => {
			order.push('start-2');
			order.push('end-2');
			return 'two';
		});

		for (let i = 0; i < 10 && !releaseFirst; i += 1) {
			await Promise.resolve();
		}
		expect(order).toEqual(['start-1']);
		releaseFirst?.();
		await expect(first).resolves.toBe('one');
		await expect(second).resolves.toBe('two');
		expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
	});

	it('debounces history_sync inbox reconcile into a single background completion', async () => {
		jest.useFakeTimers();
		const { service, providers, gateway } = createService();
		providers.getProvider.mockReturnValue({ getState: () => 'connected' });
		const unlocked = jest.fn().mockResolvedValue({ supported: true, count: 4 });
		(service as any).syncChatsUnlocked = unlocked;

		(service as any).scheduleHistoryInboxReconcile('account-1', {
			chats: 10,
			messages: 40,
		});
		(service as any).scheduleHistoryInboxReconcile('account-1', {
			chats: 8,
			messages: 25,
		});
		expect(unlocked).not.toHaveBeenCalled();

		const completed = new Promise<void>((resolve) => {
			gateway.emitAccountEvent.mockImplementation((...args: any[]) => {
				if (args[1] === 'sync_completed') resolve();
			});
		});
		jest.advanceTimersByTime(8000);
		await completed;

		expect(unlocked).toHaveBeenCalledTimes(1);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(
			'account-1',
			'sync_completed',
			expect.objectContaining({
				source: 'history_sync',
				background: true,
			}),
		);
		jest.useRealTimers();
	});

	it('routes history_sync payloads to the history persist queue', async () => {
		const { service } = createService();
		const history = jest.fn();
		const live = jest.fn();
		(service as any).enqueueHistoryPersist = (task: () => Promise<unknown>) => {
			history();
			return task();
		};
		(service as any).enqueuePersist = () => live();
		(service as any).persistHistoryBatch = jest.fn().mockResolvedValue({ inserted: 1 });
		(service as any).scheduleHistoryInboxReconcile = jest.fn();

		await (service as any).handleProviderEvent('account-1', {
			type: 'history_sync',
			chats: 2,
			messages: 1,
			payload: [{ providerMessageId: 'm1', chatId: '201000000000@c.us' }],
		});

		expect(history).toHaveBeenCalled();
		expect(live).not.toHaveBeenCalled();
		expect((service as any).persistHistoryBatch).toHaveBeenCalled();
		expect((service as any).scheduleHistoryInboxReconcile).toHaveBeenCalled();
	});
});
