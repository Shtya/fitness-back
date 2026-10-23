import { WhatsAppSyncService } from './whatsapp-sync.service';

const conversation = {
	id: 'conv-1',
	accountId: 'acc-1',
	providerChatId: '120363413263785626@g.us',
};

function makeService(options: { state?: string; failSync?: boolean; canUse?: boolean; prefs?: any[] } = {}) {
	const service: any = Object.create(WhatsAppSyncService.prototype);
	const provider = {
		getState: () => options.state ?? 'connected',
		setChatMuted: jest.fn(async () => {
			if (options.failSync) throw new Error('socket closed');
		}),
	};
	service.logger = { warn: jest.fn() };
	service.providers = { getProvider: () => provider };
	service.access = {
		assertConversationVisible: jest.fn(async () => ({
			conversation,
			accountAccess: { canUse: options.canUse ?? true },
		})),
		filterNotificationEnabledRecipients: jest.fn(async (_account: string, ids: string[]) => ids),
	};
	service.saveConversationPreference = jest.fn(async () => undefined);
	service.preferenceRepo = { find: jest.fn(async () => options.prefs || []) };
	return { service, provider };
}

describe('WhatsAppSyncService.setConversationMuted', () => {
	it('saves the in-app mute and mirrors it on WhatsApp ("always")', async () => {
		const { service, provider } = makeService();
		const result = await service.setConversationMuted({ id: 'user-1' }, 'conv-1', true, null);
		expect(service.saveConversationPreference).toHaveBeenCalledWith('user-1', 'conv-1', {
			isMuted: true,
			mutedUntil: null,
		});
		expect(provider.setChatMuted).toHaveBeenCalledWith(conversation.providerChatId, true, null);
		expect(result).toMatchObject({ ok: true, isMuted: true, syncedToWhatsApp: true });
	});

	it('passes the end time and unmutes on WhatsApp too', async () => {
		const { service, provider } = makeService();
		const until = new Date('2026-10-24T08:00:00.000Z');
		await service.setConversationMuted({ id: 'user-1' }, 'conv-1', true, until.toISOString());
		expect(provider.setChatMuted).toHaveBeenLastCalledWith(conversation.providerChatId, true, until);
		await service.setConversationMuted({ id: 'user-1' }, 'conv-1', false, null);
		expect(provider.setChatMuted).toHaveBeenLastCalledWith(conversation.providerChatId, false, null);
	});

	it('keeps the in-app mute when WhatsApp is offline or the sync fails', async () => {
		const offline = makeService({ state: 'disconnected' });
		const offlineResult = await offline.service.setConversationMuted({ id: 'u' }, 'conv-1', true, null);
		expect(offline.provider.setChatMuted).not.toHaveBeenCalled();
		expect(offlineResult).toMatchObject({ isMuted: true, syncedToWhatsApp: false });

		const failing = makeService({ failSync: true });
		const failResult = await failing.service.setConversationMuted({ id: 'u' }, 'conv-1', true, null);
		expect(failing.service.saveConversationPreference).toHaveBeenCalled();
		expect(failResult.syncedToWhatsApp).toBe(false);
	});

	it('does not touch WhatsApp for view-only members', async () => {
		const { service, provider } = makeService({ canUse: false });
		await service.setConversationMuted({ id: 'u' }, 'conv-1', true, null);
		expect(provider.setChatMuted).not.toHaveBeenCalled();
	});
});

describe('WhatsAppSyncService.getConversationNotifyState', () => {
	it('reports an active mute and ignores an expired one', async () => {
		const muted = makeService({ prefs: [{ userId: 'user-1', isMuted: true, mutedUntil: null }] });
		expect(await muted.service.getConversationNotifyState({ id: 'user-1' }, 'conv-1')).toEqual({
			conversationId: 'conv-1',
			isMuted: true,
			notificationsEnabled: true,
		});
		const expired = makeService({
			prefs: [{ userId: 'user-1', isMuted: true, mutedUntil: new Date(Date.now() - 60_000) }],
		});
		expect((await expired.service.getConversationNotifyState({ id: 'user-1' }, 'conv-1')).isMuted).toBe(false);
	});
});
