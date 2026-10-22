import { WhatsAppSyncService } from './whatsapp-sync.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function fakeSync(row: any) {
	const updates: any[] = [];
	const self: any = Object.create(WhatsAppSyncService.prototype);
	Object.assign(self, {
		messageRepo: {
			findOne: jest.fn().mockResolvedValue(row),
			update: jest.fn(async (id: string, patch: any) => {
				updates.push({ id, patch });
			}),
		},
		emitScopedConversationEvent: jest.fn().mockResolvedValue(null),
		logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn() },
	});
	return { self, updates };
}

const persist = (self: any, event: any) =>
	(WhatsAppSyncService.prototype as any).persistMessageEdit.call(self, ACCOUNT, event);

describe('WhatsAppSyncService contact message edits', () => {
	const editedAt = new Date('2026-10-22T12:30:00Z');

	it('stores the previous text, the new text and emits message_updated', async () => {
		const { self, updates } = fakeSync({
			id: 'msg-1',
			conversationId: 'conv-1',
			direction: 'inbound',
			text: 'Hgg',
			editHistory: null,
		});
		await persist(self, { providerMessageId: 'WAMSG1', text: 'Hello', editedAt, fromMe: false });
		expect(updates).toHaveLength(1);
		expect(updates[0].patch).toMatchObject({
			text: 'Hello',
			editHistory: [{ previousText: 'Hgg', text: 'Hello', by: 'contact', editedAt: editedAt.toISOString() }],
		});
		expect(self.emitScopedConversationEvent).toHaveBeenCalledWith(
			'conv-1',
			'message_updated',
			expect.objectContaining({ messageId: 'msg-1', changes: expect.objectContaining({ text: 'Hello' }) }),
			ACCOUNT,
		);
	});

	it('ignores the duplicate delivery of the same edit', async () => {
		const { self, updates } = fakeSync({
			id: 'msg-1',
			conversationId: 'conv-1',
			direction: 'inbound',
			text: 'Hello',
			editHistory: [{ previousText: 'Hgg', text: 'Hello', by: 'contact', editedAt: editedAt.toISOString() }],
		});
		await persist(self, { providerMessageId: 'WAMSG1', text: 'Hello', editedAt, fromMe: false });
		expect(updates).toHaveLength(0);
		expect(self.emitScopedConversationEvent).not.toHaveBeenCalled();
	});
});
