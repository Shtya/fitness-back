import { HttpException } from '@nestjs/common';
import { WhatsAppMessageDirection } from '../entities/whatsapp.entity';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user-1' } as any;

const target = {
	statusId: 'status-row-1',
	ownerJid: '201555555555@c.us',
	title: 'Sara',
	statusQuote: {
		statusMessageId: 'STORYTHEIRS',
		providerStatusId: 'false_status@broadcast_STORYTHEIRS_201555555555@c.us',
		ownerJid: '201555555555@c.us',
		type: 'image',
		caption: 'Sunset',
	},
};

function fakeSync(existingReaction: { emoji: string } | null = null) {
	const statusService = {
		resolveStatusInteractionTarget: jest.fn().mockResolvedValue(target),
		getOwnStatusReaction: jest.fn().mockResolvedValue(existingReaction),
		saveStatusReaction: jest.fn(async (_a, _s, actor, emoji) => ({ actorKey: actor, emoji })),
	};
	const self: any = Object.create(WhatsAppSyncService.prototype);
	Object.assign(self, {
		statusService,
		statusReactionsInFlight: new Set<string>(),
		audit: { write: jest.fn().mockResolvedValue(undefined) },
		logger: { warn: jest.fn() },
		openConversationByChatId: jest.fn().mockResolvedValue({ id: 'conv-1' }),
		sendText: jest.fn(async (_u, _c, text) => ({ ok: true, message: { id: 'msg-1', text } })),
	});
	return { self, statusService };
}

describe('WhatsAppSyncService story replies', () => {
	it('sends the reply into the poster chat quoting the story', async () => {
		const { self } = fakeSync();
		const result = await WhatsAppSyncService.prototype.replyToStatus.call(
			self,
			user,
			ACCOUNT,
			'status-row-1',
			'  Looks great  ',
			'client-1',
		);
		expect(self.openConversationByChatId).toHaveBeenCalledWith(user, ACCOUNT, '201555555555@c.us', {
			title: 'Sara',
		});
		expect(self.sendText).toHaveBeenCalledWith(
			user,
			'conv-1',
			'Looks great',
			{ statusQuote: target.statusQuote },
			'client-1',
		);
		expect(result).toMatchObject({ ok: true, conversationId: 'conv-1', message: { id: 'msg-1' } });
		expect(self.audit.write).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'whatsapp.status.replied', targetId: 'status-row-1' }),
		);
	});

	it('rejects an empty reply before touching WhatsApp', async () => {
		const { self, statusService } = fakeSync();
		await expect(
			WhatsAppSyncService.prototype.replyToStatus.call(self, user, ACCOUNT, 'status-row-1', '   '),
		).rejects.toThrow('Reply text is required');
		expect(statusService.resolveStatusInteractionTarget).not.toHaveBeenCalled();
		expect(self.sendText).not.toHaveBeenCalled();
	});
});

describe('WhatsAppSyncService story reactions', () => {
	it('sends a new reaction as a story reply and stores it', async () => {
		const { self, statusService } = fakeSync();
		const result = await WhatsAppSyncService.prototype.reactToStatus.call(
			self,
			user,
			ACCOUNT,
			'status-row-1',
			'😍',
		);
		expect(self.sendText).toHaveBeenCalledWith(user, 'conv-1', '😍', {
			statusQuote: target.statusQuote,
		});
		expect(statusService.saveStatusReaction).toHaveBeenCalledWith(
			ACCOUNT,
			'STORYTHEIRS',
			'me',
			'😍',
			'msg-1',
			expect.any(Date),
		);
		expect(result).toMatchObject({ ok: true, duplicate: false, reaction: { emoji: '😍' } });
	});

	it('treats the same emoji again as a no-op instead of a second message', async () => {
		const { self, statusService } = fakeSync({ emoji: '😍' });
		const result = await WhatsAppSyncService.prototype.reactToStatus.call(
			self,
			user,
			ACCOUNT,
			'status-row-1',
			'😍',
		);
		expect(result).toMatchObject({ ok: true, duplicate: true });
		expect(self.sendText).not.toHaveBeenCalled();
		expect(statusService.saveStatusReaction).not.toHaveBeenCalled();
	});

	it('replaces a previous reaction with a different emoji', async () => {
		const { self, statusService } = fakeSync({ emoji: '😂' });
		await WhatsAppSyncService.prototype.reactToStatus.call(self, user, ACCOUNT, 'status-row-1', '🔥');
		expect(self.sendText).toHaveBeenCalledTimes(1);
		expect(statusService.saveStatusReaction.mock.calls[0][3]).toBe('🔥');
	});

	it('rejects a second tap while the first reaction is still sending', async () => {
		const { self } = fakeSync();
		let release: () => void = () => undefined;
		self.sendText.mockImplementationOnce(
			() =>
				new Promise(resolve => {
					release = () => resolve({ ok: true, message: { id: 'msg-1' } });
				}),
		);
		const first = WhatsAppSyncService.prototype.reactToStatus.call(
			self,
			user,
			ACCOUNT,
			'status-row-1',
			'😍',
		);
		await new Promise(resolve => setImmediate(resolve));
		await expect(
			WhatsAppSyncService.prototype.reactToStatus.call(self, user, ACCOUNT, 'status-row-1', '😍'),
		).rejects.toBeInstanceOf(HttpException);
		release();
		await first;
		expect(self.sendText).toHaveBeenCalledTimes(1);
		expect(self.statusReactionsInFlight.size).toBe(0);
	});

	it('rejects text that is not a single emoji', async () => {
		const { self, statusService } = fakeSync();
		for (const value of ['ok', '😍😍', '']) {
			await expect(
				WhatsAppSyncService.prototype.reactToStatus.call(self, user, ACCOUNT, 'status-row-1', value),
			).rejects.toThrow('A story reaction must be a single emoji');
		}
		expect(statusService.resolveStatusInteractionTarget).not.toHaveBeenCalled();
	});

	it('releases the lock when sending fails', async () => {
		const { self } = fakeSync();
		self.sendText.mockRejectedValueOnce(new Error('WhatsApp account is not connected'));
		await expect(
			WhatsAppSyncService.prototype.reactToStatus.call(self, user, ACCOUNT, 'status-row-1', '😍'),
		).rejects.toThrow('not connected');
		expect(self.statusReactionsInFlight.size).toBe(0);
	});
});

describe('WhatsAppSyncService inbound story reactions', () => {
	const statusReplyRaw = (text: string) => ({
		key: { remoteJid: '201777777777@s.whatsapp.net', id: 'IN1', fromMe: false },
		message: {
			extendedTextMessage: {
				text,
				contextInfo: {
					remoteJid: 'status@broadcast',
					stanzaId: 'STORYOWN',
					participant: '201000000000@s.whatsapp.net',
					quotedMessage: { imageMessage: { caption: 'Sunset' } },
				},
			},
		},
	});

	it('records a single-emoji reply to our story as that contact’s reaction', async () => {
		const { self, statusService } = fakeSync();
		await (WhatsAppSyncService.prototype as any).recordStatusReactionFromMessage.call(
			self,
			ACCOUNT,
			{
				providerMessageId: 'IN1',
				chatId: '201777777777@c.us',
				senderWaId: '201777777777@c.us',
				fromMe: false,
				type: 'text',
				text: '😂',
				timestamp: new Date('2026-10-13T12:00:00Z'),
				raw: statusReplyRaw('😂'),
			},
			'msg-in-1',
		);
		expect(statusService.saveStatusReaction).toHaveBeenCalledWith(
			ACCOUNT,
			'STORYOWN',
			'201777777777@s.whatsapp.net',
			'😂',
			'msg-in-1',
			new Date('2026-10-13T12:00:00Z'),
		);
	});

	it('leaves text replies and ordinary quotes alone', async () => {
		const { self, statusService } = fakeSync();
		const call = (raw: any, text: string) =>
			(WhatsAppSyncService.prototype as any).recordStatusReactionFromMessage.call(self, ACCOUNT, {
				providerMessageId: 'IN2',
				chatId: '201777777777@c.us',
				fromMe: false,
				type: 'text',
				text,
				timestamp: new Date(),
				raw,
			});
		await call(statusReplyRaw('So nice!'), 'So nice!');
		await call(
			{ message: { extendedTextMessage: { text: '😂', contextInfo: { stanzaId: 'X' } } } },
			'😂',
		);
		expect(statusService.saveStatusReaction).not.toHaveBeenCalled();
	});

	it('tags a story reply so the chat renders a Status quote card', () => {
		const self: any = Object.create(WhatsAppSyncService.prototype);
		const inbound: any = {
			direction: WhatsAppMessageDirection.INBOUND,
			quotedProviderMessageId: 'STORYOWN',
			raw: statusReplyRaw('So nice!'),
		};
		const ordinary: any = {
			direction: WhatsAppMessageDirection.INBOUND,
			raw: {
				message: {
					extendedTextMessage: {
						text: 'hi',
						contextInfo: { stanzaId: 'M1', quotedMessage: { conversation: 'earlier' } },
					},
				},
			},
		};
		(WhatsAppSyncService.prototype as any).attachReplyPreviews.call(self, [inbound, ordinary]);
		expect(inbound.replyTo).toMatchObject({
			isStatus: true,
			providerMessageId: 'STORYOWN',
			statusOwnerWaId: '201000000000@s.whatsapp.net',
			type: 'image',
			text: 'Sunset',
			direction: 'outbound',
		});
		expect(ordinary.replyTo.isStatus).toBeUndefined();
	});
});
