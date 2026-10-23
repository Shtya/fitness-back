import { computeReplyGap } from './whatsapp-reply-gap';

const at = (hhmm: string) => `2026-10-23T${hhmm}:00.000Z`;
const msg = (direction: string, hhmm: string) => ({ direction, providerTimestamp: at(hhmm) });

describe('computeReplyGap', () => {
	it('measures from my last message to their first reply', () => {
		// newest first: they replied at 14:00 (and again 14:10) to my 13:00 message.
		const gap = computeReplyGap([msg('inbound', '14:10'), msg('inbound', '14:00'), msg('outbound', '13:00'), msg('outbound', '12:30')]);
		expect(gap).toEqual({
			ok: true,
			myMessageAt: at('13:00'),
			theirReplyAt: at('14:00'),
			theirLastAt: at('14:10'),
			gapMs: 60 * 60 * 1000,
		});
	});

	it('uses the last finished exchange when I already answered', () => {
		const gap = computeReplyGap([msg('outbound', '15:00'), msg('inbound', '14:00'), msg('outbound', '13:30')]);
		expect(gap.ok && gap.gapMs).toBe(30 * 60 * 1000);
	});

	it('explains why there is nothing to measure', () => {
		expect(computeReplyGap([])).toEqual({ ok: false, reason: 'no_reply' });
		expect(computeReplyGap([msg('outbound', '13:00')])).toEqual({ ok: false, reason: 'no_reply' });
		expect(computeReplyGap([msg('inbound', '13:00')])).toEqual({ ok: false, reason: 'no_my_message' });
	});

	it('ignores rows without a valid time', () => {
		const gap = computeReplyGap([
			{ direction: 'inbound', providerTimestamp: 'not a date' },
			msg('inbound', '10:20'),
			msg('outbound', '10:00'),
		]);
		expect(gap.ok && gap.gapMs).toBe(20 * 60 * 1000);
	});
});
