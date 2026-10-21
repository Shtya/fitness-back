import { WhatsAppSyncService } from './whatsapp-sync.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function fakeSync(previous: Array<{ actorKey: string; emoji: string; reactedAt: Date | null }>) {
	const saved: any[] = [];
	const deleteChain = {
		delete: () => deleteChain,
		from: () => deleteChain,
		where: () => deleteChain,
		execute: jest.fn().mockResolvedValue(undefined),
	};
	const manager = {
		createQueryBuilder: () => deleteChain,
		create: (_entity: unknown, row: any) => ({ ...row }),
		save: jest.fn(async (_entity: unknown, rows: any[]) => {
			saved.splice(0, saved.length, ...rows.map((row, index) => ({ id: `r${index}`, ...row })));
			return rows;
		}),
	};
	const reactionRepo = {
		find: jest
			.fn()
			.mockResolvedValueOnce(previous)
			.mockImplementation(async () => saved),
		manager: { transaction: async (work: (m: typeof manager) => Promise<void>) => work(manager) },
	};
	const self: any = Object.create(WhatsAppSyncService.prototype);
	Object.assign(self, {
		messageRepo: { findOne: jest.fn().mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1' }) },
		reactionRepo,
		conversationRepo: { findOne: jest.fn().mockResolvedValue({ id: 'conv-1', groupId: null }) },
		reactionActorIdentities: jest.fn().mockResolvedValue(new Map()),
		emitScopedConversationEvent: jest.fn().mockResolvedValue(null),
		findLastPreviewMessages: jest.fn().mockResolvedValue(new Map()),
	});
	return { self, saved };
}

const write = (self: any, reactions: any[]) =>
	(WhatsAppSyncService.prototype as any).writeMessageReactions.call(self, ACCOUNT, 'WAMSG1', reactions);

describe('WhatsAppSyncService message reaction times', () => {
	const firstAt = new Date('2026-10-20T09:15:00Z');

	it('stores the time WhatsApp sent with the reaction', async () => {
		const { self, saved } = fakeSync([]);
		await write(self, [{ actorKey: '201111111111@s.whatsapp.net', emoji: '❤️', timestamp: firstAt }]);
		expect(saved[0]).toMatchObject({ emoji: '❤️', reactedAt: firstAt });
	});

	it('keeps the earlier time when a later snapshot repeats the same emoji without one', async () => {
		const { self, saved } = fakeSync([
			{ actorKey: '201111111111@s.whatsapp.net', emoji: '❤️', reactedAt: firstAt },
		]);
		await write(self, [
			{ actorKey: '201111111111@s.whatsapp.net', emoji: '❤️', timestamp: null },
			{ actorKey: 'me', emoji: '😂', timestamp: new Date('2026-10-21T08:00:00Z') },
		]);
		expect(saved.find(row => row.actorKey === '201111111111@s.whatsapp.net')?.reactedAt).toEqual(firstAt);
		expect(saved.find(row => row.actorKey === 'me')?.reactedAt).toEqual(new Date('2026-10-21T08:00:00Z'));
	});

	it('does not reuse the old time once the person switches to another emoji', async () => {
		const { self, saved } = fakeSync([
			{ actorKey: '201111111111@s.whatsapp.net', emoji: '❤️', reactedAt: firstAt },
		]);
		await write(self, [{ actorKey: '201111111111@s.whatsapp.net', emoji: '👍', timestamp: null }]);
		expect(saved[0]).toMatchObject({ emoji: '👍', reactedAt: null });
	});
});
