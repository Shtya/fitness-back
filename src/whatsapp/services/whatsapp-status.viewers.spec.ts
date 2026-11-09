import { WhatsAppStatusService } from './whatsapp-status.service';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const STORY = {
	id: '99999999-2222-4333-8444-555555555555',
	accountId: ACCOUNT,
	// stored before the fix: posted from the phone under our LID, saved as a contact's
	providerStatusId: 'false_status@broadcast_3EB0PHONE_99887766554433@lid',
	senderWaId: '99887766554433@lid',
	isOwn: false,
	type: 'image',
	expiresAt: new Date(Date.now() + 3_600_000),
};

function createService(queryRows: (sql: string) => any[]) {
	const repo = {
		findOne: jest.fn(async ({ where }: any) => (where.id === STORY.id || where.providerStatusId === STORY.id ? STORY : null)),
		manager: { query: jest.fn(async (sql: string, _params?: unknown[]) => queryRows(sql)) },
	};
	const contactRepo = {
		find: jest.fn().mockResolvedValue([
			{ waId: '201333333333@s.whatsapp.net', name: 'Noor Saleh', phoneNumber: '201333333333', avatarUrl: '/a/noor.jpg' },
			{ waId: '201444444444@s.whatsapp.net', name: 'Youssef', phoneNumber: '201444444444', avatarUrl: null },
		]),
	};
	const provider = {
		getState: () => 'disconnected',
		getOwnJids: () => ['201011112222@s.whatsapp.net', '99887766554433@lid'],
	};
	const service = new WhatsAppStatusService(
		repo as any,
		{ findOne: jest.fn().mockResolvedValue(null) } as any,
		contactRepo as any,
		{} as any,
		{ assertAccountPermission: jest.fn().mockResolvedValue(undefined) } as any,
		{ getProvider: jest.fn(() => provider) } as any,
		{} as any,
		{ emitAccountEvent: jest.fn() } as any,
	);
	return { service, repo };
}

describe('story viewers', () => {
	it('lists viewers, reactions and comments for a story we posted from the phone', async () => {
		const { service, repo } = createService(sql => {
			if (sql.includes('FROM whatsapp_accounts')) return [{ phone_number: '201011112222' }];
			if (sql.includes('FROM whatsapp_status_viewers')) {
				return [{ viewer_key: '201333333333@s.whatsapp.net', viewed_at: '2026-11-09T10:00:00Z' }];
			}
			if (sql.includes('FROM whatsapp_status_reactions')) {
				return [{ actor_key: '201333333333@s.whatsapp.net', emoji: '😍', reacted_at: '2026-11-09T10:01:00Z' }];
			}
			if (sql.includes('FROM whatsapp_messages')) {
				return [
					// the emoji reply is the reaction above, not a comment
					{ id: 'm0', conversation_id: 'c1', sender_wa_id: '201333333333@s.whatsapp.net', type: 'text', text: '😍', provider_timestamp: '2026-11-09T10:01:00Z', provider_chat_id: '201333333333@s.whatsapp.net' },
					{ id: 'm1', conversation_id: 'c2', sender_wa_id: null, type: 'text', text: 'حلوة جدا', provider_timestamp: '2026-11-09T10:05:00Z', provider_chat_id: '201444444444@c.us' },
					{ id: 'm2', conversation_id: 'c2', sender_wa_id: null, type: 'text', text: 'where is this?', provider_timestamp: '2026-11-09T10:06:00Z', provider_chat_id: '201444444444@c.us' },
				];
			}
			return [];
		});
		const out = await service.listStatusViewers({ id: 'u1' } as any, ACCOUNT, STORY.id);
		expect(out.viewerCount).toBe(2);
		expect(out.reactionCount).toBe(1);
		expect(out.replyCount).toBe(2);
		const noor = out.viewers.find(v => v.name === 'Noor Saleh');
		expect(noor).toMatchObject({ reaction: '😍', avatarUrl: '/a/noor.jpg', replies: [] });
		const youssef = out.viewers.find(v => v.name === 'Youssef');
		expect(youssef?.replies.map(r => r.text)).toEqual(['حلوة جدا', 'where is this?']);
		expect(youssef?.replies[0]).toMatchObject({ conversationId: 'c2', messageId: 'm1' });
		// replies are looked up by the bare story id they quote
		const replyQuery = repo.manager.query.mock.calls.find(([sql]) => sql.includes('FROM whatsapp_messages'));
		expect(replyQuery?.[1]).toEqual([ACCOUNT, '3EB0PHONE']);
	});

	it('still refuses the viewer list of someone else\'s story', async () => {
		const { service } = createService(sql => (sql.includes('FROM whatsapp_accounts') ? [{ phone_number: '201011112222' }] : []));
		STORY.senderWaId = '55555555555555@lid';
		try {
			await expect(service.listStatusViewers({ id: 'u1' } as any, ACCOUNT, STORY.id)).rejects.toThrow(/owner/);
		} finally {
			STORY.senderWaId = '99887766554433@lid';
		}
	});
});
