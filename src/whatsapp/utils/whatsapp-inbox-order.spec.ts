import { REPAIR_INBOX_ORDER_SQL, shouldAdvanceLastMessageAt } from './whatsapp-inbox-order';

describe('inbox order', () => {
	const today = new Date('2026-11-09T10:00:00Z');
	const lastWeek = new Date('2026-11-02T10:00:00Z');

	it('moves a chat forward to a newer message', () => {
		expect(shouldAdvanceLastMessageAt(lastWeek, today)).toBe(true);
		expect(shouldAdvanceLastMessageAt(null, lastWeek)).toBe(true);
	});

	it('never moves a chat back to an older time (the relink bug)', () => {
		expect(shouldAdvanceLastMessageAt(today, lastWeek)).toBe(false);
		expect(shouldAdvanceLastMessageAt(today, today)).toBe(false);
	});

	it('ignores missing or invalid times', () => {
		expect(shouldAdvanceLastMessageAt(today, null)).toBe(false);
		expect(shouldAdvanceLastMessageAt(today, 'not a date')).toBe(false);
		expect(shouldAdvanceLastMessageAt(today, new Date(0))).toBe(false);
	});

	it('repair only raises values, for one account', () => {
		expect(REPAIR_INBOX_ORDER_SQL).toContain('conversation.last_message_at < newest.max_at');
		expect(REPAIR_INBOX_ORDER_SQL).toContain('account_id = $1');
		expect(REPAIR_INBOX_ORDER_SQL).not.toMatch(/last_message_at\s*>/);
	});
});
