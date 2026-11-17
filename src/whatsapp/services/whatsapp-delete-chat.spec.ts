import { WhatsAppSyncService } from './whatsapp-sync.service';

const DELETED_AT = new Date('2026-11-17T10:00:00Z');

function service(row: any) {
	const self: any = Object.create(WhatsAppSyncService.prototype);
	self.conversationHotCache = new Map();
	self.conversationRepo = {
		findOne: jest.fn(async () => row),
		restore: jest.fn(async () => undefined),
	};
	self.findDirectConversationAlias = jest.fn(async () => null);
	self.applyConversationIdentityPatch = jest.fn(async (conversation: any) => conversation);
	self.rebindConversationPreferences = jest.fn(async () => undefined);
	self.rememberConversation = jest.fn((_a: string, _c: string, conversation: any) => conversation);
	return self;
}

const deletedChat = () => ({ id: 'c1', accountId: 'acc', providerChatId: '2010@c.us', deleted_at: new Date(DELETED_AT) });

describe('a deleted chat stays deleted', () => {
	it('is not brought back by the phone chat list or by history from before the delete', async () => {
		const row = deletedChat();
		const svc = service(row);
		await svc.ensureConversation('acc', '2010@c.us', { activityAt: new Date('2026-11-16T09:00:00Z') });
		await svc.ensureConversation('acc', '2010@c.us', {}); // no activity time (e.g. presence)
		expect(svc.conversationRepo.restore).not.toHaveBeenCalled();
		expect(row.deleted_at).not.toBeNull();
	});

	it('comes back when a message newer than the delete arrives', async () => {
		const row = deletedChat();
		const svc = service(row);
		await svc.ensureConversation('acc', '2010@c.us', { activityAt: new Date('2026-11-17T10:05:00Z') });
		expect(svc.conversationRepo.restore).toHaveBeenCalledWith('c1');
		expect(row.deleted_at).toBeNull();
	});

	it('comes back when the user opens it on purpose', async () => {
		const row = deletedChat();
		const svc = service(row);
		await svc.ensureConversation('acc', '2010@c.us', { restore: true });
		expect(svc.conversationRepo.restore).toHaveBeenCalledWith('c1');
	});

	it('read-state from the phone does not find (or restore) a deleted chat', async () => {
		const svc = service(deletedChat());
		expect(await svc.findInboxConversation('acc', '2010@c.us')).toBeNull();
		expect(svc.conversationRepo.restore).not.toHaveBeenCalled();
	});

	it('a cached deleted chat follows the same rule', async () => {
		const row = deletedChat();
		const svc = service(row);
		svc.conversationHotCache.set('acc:2010@c.us', { conversation: row, at: Date.now() });
		await svc.ensureConversation('acc', '2010@c.us', {});
		expect(row.deleted_at).not.toBeNull();
		await svc.ensureConversation('acc', '2010@c.us', { activityAt: Date.parse('2026-11-17T11:00:00Z') });
		expect(row.deleted_at).toBeNull();
	});
});
