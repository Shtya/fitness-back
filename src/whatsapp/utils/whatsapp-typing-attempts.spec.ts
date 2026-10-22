import {
	TYPING_MESSAGE_WINDOW_MS,
	TYPING_SESSION_GAP_MS,
	TypingAttemptLike,
	attemptAcceptsMessage,
	decideTypingTransition,
	desiredOnlinePresence,
	normalizeTypingAttemptFilter,
	onlinePresenceMode,
	serializeTypingAttempt,
	typingCheckpointFor,
	typingPresenceSignal,
	typingSentWithinMinutes,
} from './whatsapp-typing-attempts';

const t0 = new Date('2026-10-22T10:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const attempt = (patch: Partial<TypingAttemptLike> = {}): TypingAttemptLike => ({
	id: 'a1',
	status: 'typing',
	startedAt: t0,
	lastTypingAt: t0,
	stoppedAt: null,
	...patch,
});

describe('whatsapp typing attempts', () => {
	it('maps only real chatstate values to signals', () => {
		expect(typingPresenceSignal('composing')).toBe('typing');
		expect(typingPresenceSignal('recording')).toBe('recording');
		expect(typingPresenceSignal('paused')).toBe('stop');
		expect(typingPresenceSignal('available')).toBe('stop');
		expect(typingPresenceSignal('unavailable')).toBe('stop');
		expect(typingPresenceSignal('')).toBeNull();
		expect(typingPresenceSignal('subscribe')).toBeNull();
	});

	it('starts an attempt on the first composing event', () => {
		expect(decideTypingTransition(null, 'typing', t0)).toEqual({ action: 'insert', supersede: null });
	});

	it('ignores a stop with no live attempt (online pings, late paused)', () => {
		expect(decideTypingTransition(null, 'stop', t0)).toEqual({ action: 'noop' });
		expect(decideTypingTransition(attempt({ status: 'stopped' }), 'stop', t0)).toEqual({ action: 'noop' });
		expect(decideTypingTransition(attempt({ status: 'sent' }), 'stop', t0)).toEqual({ action: 'noop' });
	});

	it('extends instead of duplicating on repeated composing', () => {
		expect(decideTypingTransition(attempt(), 'typing', at(2_000))).toEqual({ action: 'extend', id: 'a1' });
	});

	it('resumes the same attempt within the session gap, starts a new one after it', () => {
		const stopped = attempt({ status: 'stopped', lastTypingAt: t0, stoppedAt: at(1_000) });
		expect(decideTypingTransition(stopped, 'typing', at(TYPING_SESSION_GAP_MS))).toEqual({
			action: 'extend',
			id: 'a1',
		});
		expect(decideTypingTransition(stopped, 'typing', at(TYPING_SESSION_GAP_MS + 2_000))).toEqual({
			action: 'insert',
			supersede: 'a1',
		});
	});

	it('starts a fresh attempt after a sent or expired one', () => {
		expect(decideTypingTransition(attempt({ status: 'sent' }), 'typing', at(1_000))).toEqual({
			action: 'insert',
			supersede: null,
		});
		expect(decideTypingTransition(attempt({ status: 'no_message' }), 'typing', at(1_000))).toEqual({
			action: 'insert',
			supersede: null,
		});
	});

	it('links a message 1, 5 or 30 minutes after typing, not after the window', () => {
		const stopped = attempt({ status: 'stopped' });
		expect(attemptAcceptsMessage(stopped, at(60_000))).toBe(true);
		expect(attemptAcceptsMessage(stopped, at(5 * 60_000))).toBe(true);
		expect(attemptAcceptsMessage(stopped, at(TYPING_MESSAGE_WINDOW_MS))).toBe(true);
		expect(attemptAcceptsMessage(stopped, at(TYPING_MESSAGE_WINDOW_MS + 1))).toBe(false);
	});

	it('never links to a closed attempt, a missing one, or a message before typing', () => {
		expect(attemptAcceptsMessage(null, t0)).toBe(false);
		expect(attemptAcceptsMessage(attempt({ status: 'sent' }), at(1_000))).toBe(false);
		expect(attemptAcceptsMessage(attempt({ status: 'no_message' }), at(1_000))).toBe(false);
		expect(attemptAcceptsMessage(attempt(), at(-60_000))).toBe(false);
	});

	it('buckets follow-up checkpoints 1/2/3/5/10/20/30', () => {
		expect(typingCheckpointFor(30_000)).toBe(0);
		expect(typingCheckpointFor(60_000)).toBe(1);
		expect(typingCheckpointFor(4 * 60_000)).toBe(3);
		expect(typingCheckpointFor(19 * 60_000)).toBe(10);
		expect(typingCheckpointFor(45 * 60_000)).toBe(30);
		expect(typingSentWithinMinutes(20_000)).toBe(1);
		expect(typingSentWithinMinutes(4 * 60_000)).toBe(5);
		expect(typingSentWithinMinutes(30 * 60_000)).toBe(30);
		expect(typingSentWithinMinutes(31 * 60_000)).toBeNull();
	});

	it('serializes UTC instants and derived gaps', () => {
		const row = {
			id: 'a1',
			account_id: 'acc',
			conversation_id: 'conv',
			status: 'sent',
			kind: 'typing',
			started_at: t0,
			last_typing_at: at(10_000),
			message_at: at(70_000),
			checkpoint_minutes: 1,
			contact_name: ' Sara ',
		};
		const out = serializeTypingAttempt(row, at(120_000));
		expect(out.startedAt).toBe('2026-10-22T10:00:00.000Z');
		expect(out.gapFromStartMs).toBe(70_000);
		expect(out.gapFromLastTypingMs).toBe(60_000);
		expect(out.sentWithinMinutes).toBe(1);
		expect(out.sinceTypingMs).toBeNull();
		expect(out.name).toBe('Sara');

		const waiting = serializeTypingAttempt(
			{ ...row, status: 'stopped', message_at: null },
			at(10_000 + 6 * 60_000),
		);
		expect(waiting.sinceTypingMs).toBe(6 * 60_000);
		expect(waiting.checkpointMinutes).toBe(5);
	});

	it('normalizes list filters and online-presence modes', () => {
		expect(normalizeTypingAttemptFilter('no_message')).toBe('no_message');
		expect(normalizeTypingAttemptFilter('drop table')).toBe('all');
		expect(onlinePresenceMode(undefined)).toBe('watching');
		expect(onlinePresenceMode('always')).toBe('always');
		expect(onlinePresenceMode('off')).toBe('off');
		expect(desiredOnlinePresence('watching', 0)).toBe(false);
		expect(desiredOnlinePresence('watching', 2)).toBe(true);
		expect(desiredOnlinePresence('always', 0)).toBe(true);
		expect(desiredOnlinePresence('off', 5)).toBe(false);
	});
});
