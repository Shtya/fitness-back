import {
	isGroupChatId,
	nextGroupSubject,
	providerGroupSubject,
} from './whatsapp-sync.service';

const GROUP = '120363000000000000@g.us';

describe('WhatsApp group subject', () => {
	it('detects group chat ids', () => {
		expect(isGroupChatId(GROUP)).toBe(true);
		expect(isGroupChatId('201000000000@c.us')).toBe(false);
		expect(isGroupChatId(null)).toBe(false);
	});

	it('ignores member pushName / notify when reading a provider group row', () => {
		expect(
			providerGroupSubject({
				id: GROUP,
				contact: { pushname: 'A. Gaber', notify: 'A. Gaber' },
			}),
		).toBeNull();
		expect(
			providerGroupSubject({
				id: GROUP,
				name: 'Family',
				contact: { pushname: 'A. Gaber' },
			}),
		).toBe('Family');
		expect(providerGroupSubject({ groupMetadata: { subject: 'Team' } })).toBe('Team');
	});

	it('lets the provider subject replace a stored member name', () => {
		expect(nextGroupSubject('A. Gaber', 'Family', GROUP)).toBe('Family');
		expect(nextGroupSubject('Group', 'Family', GROUP)).toBe('Family');
	});

	it('keeps the stored subject when the incoming one is weak or unchanged', () => {
		expect(nextGroupSubject('Family', null, GROUP)).toBeNull();
		expect(nextGroupSubject('Family', 'Group', GROUP)).toBeNull();
		expect(nextGroupSubject('Family', 'Family', GROUP)).toBeNull();
	});
});
