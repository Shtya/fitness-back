import { WhatsAppSyncService } from './whatsapp-sync.service';

function service(rows: any[]) {
	const s = Object.create(WhatsAppSyncService.prototype) as any;
	s.conversationRepo = { query: jest.fn(async () => rows) };
	return s;
}

const USER = { id: 'u1' } as any;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('keep in touch: groups with and without a reminder', () => {
	it('lists people in a group with no days, never as due, after everyone with a reminder', async () => {
		const s = service([
			{ conversation_id: 'quiet', days: 0, grp: 'football', last_contact_at: daysAgo(40) },
			{ conversation_id: 'due', days: 7, grp: 'family', last_contact_at: daysAgo(10) },
			{ conversation_id: 'later', days: 30, grp: 'friends', last_contact_at: daysAgo(2) },
		]);
		const items = await s.keepInTouchStatus(USER, 'acc-1', true);
		expect(items.map((item: any) => item.conversationId)).toEqual(['due', 'later', 'quiet']);
		const quiet = items.find((item: any) => item.conversationId === 'quiet');
		expect(quiet).toEqual(expect.objectContaining({ days: 0, group: 'football', dueAt: null, overdue: false }));
		expect(items.find((item: any) => item.conversationId === 'due').overdue).toBe(true);
		const [sql] = s.conversationRepo.query.mock.calls[0];
		expect(sql).toContain('p.keep_in_touch_group IS NOT NULL');
	});

	it('accepts football as a group and saves a group with no days', async () => {
		const s = Object.create(WhatsAppSyncService.prototype) as any;
		s.assertConversationVisible = jest.fn(async () => ({}));
		s.saveConversationPreference = jest.fn(async () => undefined);
		await s.setConversationKeepInTouch(USER, 'c1', null, 'football');
		expect(s.saveConversationPreference).toHaveBeenCalledWith('u1', 'c1', { keepInTouchDays: null, keepInTouchGroup: 'football' });
	});
});
