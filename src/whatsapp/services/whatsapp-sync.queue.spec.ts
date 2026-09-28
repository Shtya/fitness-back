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
		await (service as any).whenPersistIdle();

		expect(task).toHaveBeenCalledTimes(3);
	});

	it('hands a live message to the dead-letter queue after the last retry fails', async () => {
		jest.useFakeTimers({ advanceTimers: true });
		const { service } = createService();
		const deadLetters = { add: jest.fn().mockResolvedValue(undefined), start: jest.fn() };
		(service as any).deadLetters = deadLetters;
		(service as any).persistMessage = jest.fn().mockRejectedValue(new Error('db down'));
		const message = { providerMessageId: 'wamid-1', chatId: '201000000000@c.us' };

		await (service as any).handleProviderEvent('account-1', { type: 'message', message });
		await (service as any).whenPersistIdle();

		expect((service as any).persistMessage).toHaveBeenCalledTimes(3);
		expect(deadLetters.add).toHaveBeenCalledWith(
			'account-1',
			message,
			'message:account-1:wamid-1',
			expect.any(Error),
		);
		jest.useRealTimers();
	});

	describe('persist lanes (P3 — no global head-of-line blocking)', () => {
		function deferred() {
			let resolve: () => void = () => undefined;
			const promise = new Promise<void>((r) => (resolve = r));
			return { promise, resolve };
		}
		const flush = () => new Promise((resolve) => setImmediate(resolve));

		it('keys groups/channels per chat and direct chats per account', async () => {
			const { persistLaneForChat } = await import('./whatsapp-sync.service');
			expect(persistLaneForChat('a1', '120363@g.us')).toBe('a1:chat:120363@g.us');
			expect(persistLaneForChat('a1', '1203@newsletter')).toBe('a1:chat:1203@newsletter');
			expect(persistLaneForChat('a1', '201000000000@c.us')).toBe('a1:direct');
			expect(persistLaneForChat('a1', '123456@lid')).toBe('a1:direct');
		});

		it('does not let a slow chat block other accounts or groups', async () => {
			const { service } = createService();
			const slow = deferred();
			const order: string[] = [];
			(service as any).persistMessage = jest.fn(async (accountId: string, message: any) => {
				if (message.providerMessageId === 'slow') await slow.promise;
				order.push(`${accountId}:${message.providerMessageId}`);
			});

			const send = (accountId: string, providerMessageId: string, chatId: string) =>
				(service as any).handleProviderEvent(accountId, {
					type: 'message',
					message: { providerMessageId, chatId },
				});
			await send('account-1', 'slow', '201000000000@c.us');
			await send('account-2', 'other-account', '201111111111@c.us');
			await send('account-1', 'group', '120363@g.us');
			await flush();
			await flush();

			expect(order).toEqual(['account-2:other-account', 'account-1:group']);
			slow.resolve();
			await (service as any).whenPersistIdle();
			expect(order).toEqual(['account-2:other-account', 'account-1:group', 'account-1:slow']);
		});

		it('keeps direct chats (LID and phone twins) of one account in order', async () => {
			const { service } = createService();
			const first = deferred();
			const order: string[] = [];
			(service as any).persistMessage = jest.fn(async (_accountId: string, message: any) => {
				if (message.providerMessageId === 'pn') await first.promise;
				order.push(message.providerMessageId);
			});
			await (service as any).handleProviderEvent('account-1', {
				type: 'message',
				message: { providerMessageId: 'pn', chatId: '201000000000@c.us' },
			});
			await (service as any).handleProviderEvent('account-1', {
				type: 'message',
				message: { providerMessageId: 'lid', chatId: '123456@lid' },
			});
			await flush();
			expect(order).toEqual([]);
			first.resolve();
			await (service as any).whenPersistIdle();
			expect(order).toEqual(['pn', 'lid']);
		});

		it('runs a status for a queued message after that message is persisted', async () => {
			const { service } = createService();
			const gate = deferred();
			const order: string[] = [];
			(service as any).persistMessage = jest.fn(async () => {
				await gate.promise;
				order.push('message');
			});
			(service as any).messageRepo = {
				findOne: jest.fn(async () => {
					order.push('status');
					return null;
				}),
			};
			await (service as any).handleProviderEvent('account-1', {
				type: 'message',
				message: { providerMessageId: 'G1', chatId: '120363@g.us' },
			});
			await (service as any).handleProviderEvent('account-1', {
				type: 'message_status',
				providerMessageId: 'G1',
				status: 'read',
			});
			await flush();
			expect(order).toEqual([]);
			gate.resolve();
			await (service as any).whenPersistIdle();
			expect(order).toEqual(['message', 'status']);
		});

		it('caps concurrent persists across lanes', async () => {
			const { service } = createService();
			const gate = deferred();
			let running = 0;
			let peak = 0;
			const task = async () => {
				running += 1;
				peak = Math.max(peak, running);
				await gate.promise;
				running -= 1;
			};
			for (let i = 0; i < 6; i += 1) {
				(service as any).enqueuePersist(task, `t${i}`, undefined, `lane-${i}`);
			}
			await flush();
			await flush();
			expect(peak).toBe(3);
			gate.resolve();
			await (service as any).whenPersistIdle();
			expect(peak).toBe(3);
			expect((service as any).activePersists).toBe(0);
		});
	});

	describe('conversation event scoping (A4)', () => {
		it('scopes message_status (and its preview) to who may see the conversation', async () => {
			const { service, gateway, conversationRepo } = createService();
			conversationRepo.findOne.mockResolvedValue({
				id: 'conversation-1',
				assignedUserId: 'agent-2',
				providerChatId: '201000000000@c.us',
			});
			(service as any).messageRepo = {
				findOne: jest.fn().mockResolvedValue({
					id: 'm1',
					conversationId: 'conversation-1',
					providerMessageId: 'wamid-1',
					status: 'sent',
					direction: 'outbound',
					text: 'secret text',
				}),
				update: jest.fn().mockResolvedValue(undefined),
			};
			const schedule = jest.fn();
			(service as any).scheduleConversationUpdated = schedule;

			await (service as any).handleProviderEvent('account-1', {
				type: 'message_status',
				providerMessageId: 'wamid-1',
				status: 'delivered',
			});
			await (service as any).whenPersistIdle();

			const scope = { assignedUserId: 'agent-2', shared: false };
			expect(gateway.emitConversationEvent).toHaveBeenCalledWith(
				'conversation-1',
				'message_status',
				expect.objectContaining({ status: 'delivered' }),
				'account-1',
				scope,
			);
			expect(schedule).toHaveBeenCalledWith(
				'account-1',
				expect.objectContaining({ conversationId: 'conversation-1' }),
				scope,
			);
		});

		it('caches the scope lookup across an ack burst', async () => {
			const { service, conversationRepo } = createService();
			conversationRepo.findOne.mockResolvedValue({ id: 'c1', assignedUserId: null });
			for (let i = 0; i < 3; i += 1) {
				await (service as any).conversationEventScopeById('c1');
			}
			expect(conversationRepo.findOne).toHaveBeenCalledTimes(1);
		});

		it('denies restricted members when the conversation no longer exists', async () => {
			const { service, conversationRepo } = createService();
			conversationRepo.findOne.mockResolvedValue(null);
			await expect((service as any).conversationEventScopeById('gone')).resolves.toEqual({
				assignedUserId: null,
				shared: false,
			});
		});

		it('emits phone-read once, scoped, instead of account + conversation copies', async () => {
			const { service, gateway, conversationRepo } = createService();
			conversationRepo.findOne.mockResolvedValue({ id: 'c1', assignedUserId: 'agent-2' });
			const qb: any = {
				update: () => qb,
				set: () => qb,
				where: () => qb,
				andWhere: () => qb,
				execute: jest.fn().mockResolvedValue({ affected: 1 }),
			};
			(conversationRepo as any).createQueryBuilder = () => qb;

			await (service as any).clearUnreadFromPhone('account-1', 'c1');

			expect(gateway.emitAccountEvent).not.toHaveBeenCalledWith(
				'account-1',
				'conversation_read',
				expect.anything(),
			);
			expect(gateway.emitConversationEvent).toHaveBeenCalledTimes(1);
			expect(gateway.emitConversationEvent).toHaveBeenCalledWith(
				'c1',
				'conversation_read',
				{ conversationId: 'c1', reason: 'phone_read' },
				'account-1',
				{ assignedUserId: 'agent-2', shared: false },
			);
		});
	});

	it('does not dead-letter a message that persisted on retry', async () => {
		const { service } = createService();
		const onDropped = jest.fn();
		const task = jest.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);
		(service as any).enqueuePersist(task, 'message:x', onDropped);
		await (service as any).whenPersistIdle();
		expect(onDropped).not.toHaveBeenCalled();
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
