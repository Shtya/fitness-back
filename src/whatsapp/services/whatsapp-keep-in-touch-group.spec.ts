import { WhatsAppSyncService } from './whatsapp-sync.service';

function service() {
	const s = Object.create(WhatsAppSyncService.prototype) as any;
	s.assertConversationVisible = jest.fn(async () => ({}));
	s.saveConversationPreference = jest.fn(async () => undefined);
	return s;
}

const USER = { id: 'u1' } as any;

describe('keep in touch groups', () => {
	it('saves the days and the group together', async () => {
		const s = service();
		const result = await s.setConversationKeepInTouch(USER, 'c1', 10, 'family');
		expect(s.saveConversationPreference).toHaveBeenCalledWith('u1', 'c1', { keepInTouchDays: 10, keepInTouchGroup: 'family' });
		expect(result).toEqual(expect.objectContaining({ keepInTouchDays: 10, keepInTouchGroup: 'family' }));
	});

	it('leaves the group alone when the request does not mention it', async () => {
		const s = service();
		await s.setConversationKeepInTouch(USER, 'c1', 7);
		expect(s.saveConversationPreference).toHaveBeenCalledWith('u1', 'c1', { keepInTouchDays: 7 });
	});

	it('clears the group for null or an unknown name', async () => {
		const s = service();
		await s.setConversationKeepInTouch(USER, 'c1', 7, null);
		await s.setConversationKeepInTouch(USER, 'c1', 7, 'enemies');
		expect(s.saveConversationPreference).toHaveBeenNthCalledWith(1, 'u1', 'c1', { keepInTouchDays: 7, keepInTouchGroup: null });
		expect(s.saveConversationPreference).toHaveBeenNthCalledWith(2, 'u1', 'c1', { keepInTouchDays: 7, keepInTouchGroup: null });
	});
});
