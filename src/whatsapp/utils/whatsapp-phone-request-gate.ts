/**
 * Requests that make the primary phone do work for this linked device:
 * on-demand history sync, placeholder resend, media re-upload.
 *
 * Each one wakes WhatsApp on the phone. When the phone is backgrounded or
 * battery-restricted it cannot finish, and Android shows
 * "Syncing with WhatsApp on <device> stopped. Open WhatsApp to resume."
 * Background jobs therefore never send them, and user actions are deduped,
 * rate-limited, and paused once the phone stops answering.
 */
export type PhoneRequestKind = 'history_on_demand' | 'placeholder_resend' | 'media_reupload';

export type PhoneRequestOutcome =
	| 'ok'
	| 'no_response'
	| 'failed'
	| 'skipped_background'
	| 'skipped_duplicate'
	| 'skipped_rate_limit'
	| 'skipped_phone_unresponsive';

export type PhoneRequestGateOptions = {
	now?: () => number;
	/** Max phone requests per account in any rolling minute. */
	perMinute?: number;
	/** The same message is not asked for again within this window. */
	keyCooldownMs?: number;
	/** Pause after the phone stops answering. */
	unresponsivePauseMs?: number;
	/** Consecutive unanswered requests that trigger the pause. */
	unresponsiveAfter?: number;
	log?: (line: string) => void;
};

const DEFAULTS = {
	perMinute: 6,
	keyCooldownMs: 10 * 60_000,
	unresponsivePauseMs: 5 * 60_000,
	unresponsiveAfter: 2,
};
const KEY_HISTORY_MAX = 2000;

function shortKey(key: string) {
	const value = String(key || '');
	return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

export class PhoneRequestGate {
	private readonly now: () => number;
	private readonly perMinute: number;
	private readonly keyCooldownMs: number;
	private readonly unresponsivePauseMs: number;
	private readonly unresponsiveAfter: number;
	private readonly log: (line: string) => void;
	private readonly sentAt: number[] = [];
	private readonly lastByKey = new Map<string, number>();
	private readonly inFlight = new Map<string, Promise<unknown>>();
	private unanswered = 0;
	private pausedUntil = 0;

	constructor(
		private readonly accountId: string,
		options: PhoneRequestGateOptions = {},
	) {
		this.now = options.now || Date.now;
		this.perMinute = options.perMinute ?? DEFAULTS.perMinute;
		this.keyCooldownMs = options.keyCooldownMs ?? DEFAULTS.keyCooldownMs;
		this.unresponsivePauseMs = options.unresponsivePauseMs ?? DEFAULTS.unresponsivePauseMs;
		this.unresponsiveAfter = options.unresponsiveAfter ?? DEFAULTS.unresponsiveAfter;
		this.log = options.log || (() => undefined);
	}

	/**
	 * Runs `task` when policy allows. The task resolves `true` when the phone
	 * answered and `false` when it did not; a throw counts as a failure.
	 * Resolves the outcome — callers never see a skipped request as success.
	 */
	async run(
		kind: PhoneRequestKind,
		key: string,
		task: () => Promise<boolean>,
		options: { background?: boolean } = {},
	): Promise<PhoneRequestOutcome> {
		const dedupeKey = `${kind}:${key}`;
		const skip = this.skipReason(dedupeKey, options.background === true);
		if (skip) {
			this.record(kind, key, skip);
			return skip;
		}
		const pending = this.inFlight.get(dedupeKey);
		if (pending) {
			this.record(kind, key, 'skipped_duplicate');
			return 'skipped_duplicate';
		}
		const started = this.now();
		this.sentAt.push(started);
		this.lastByKey.delete(dedupeKey);
		this.lastByKey.set(dedupeKey, started);
		while (this.lastByKey.size > KEY_HISTORY_MAX) {
			this.lastByKey.delete(this.lastByKey.keys().next().value as string);
		}
		const attempt = (async (): Promise<PhoneRequestOutcome> => {
			try {
				const answered = await task();
				if (answered) {
					this.unanswered = 0;
					return 'ok';
				}
				this.noteUnanswered();
				return 'no_response';
			} catch {
				this.noteUnanswered();
				return 'failed';
			}
		})();
		this.inFlight.set(dedupeKey, attempt);
		try {
			const outcome = await attempt;
			this.record(kind, key, outcome, this.now() - started);
			return outcome;
		} finally {
			this.inFlight.delete(dedupeKey);
		}
	}

	isPaused() {
		return this.now() < this.pausedUntil;
	}

	private skipReason(dedupeKey: string, background: boolean): PhoneRequestOutcome | null {
		if (background) return 'skipped_background';
		const now = this.now();
		if (now < this.pausedUntil) return 'skipped_phone_unresponsive';
		const last = this.lastByKey.get(dedupeKey);
		if (last !== undefined && now - last < this.keyCooldownMs) return 'skipped_duplicate';
		while (this.sentAt.length && now - this.sentAt[0] >= 60_000) this.sentAt.shift();
		if (this.sentAt.length >= this.perMinute) return 'skipped_rate_limit';
		return null;
	}

	private noteUnanswered() {
		this.unanswered += 1;
		if (this.unanswered >= this.unresponsiveAfter) {
			this.pausedUntil = this.now() + this.unresponsivePauseMs;
			this.unanswered = 0;
			this.log(
				`[WA] phone_request account=${this.accountId} event=paused reason=phone_unresponsive pauseMs=${this.unresponsivePauseMs}`,
			);
		}
	}

	private record(kind: PhoneRequestKind, key: string, outcome: PhoneRequestOutcome, ms?: number) {
		this.log(
			`[WA] phone_request account=${this.accountId} kind=${kind} key=${shortKey(key)} outcome=${outcome}${
				ms === undefined ? '' : ` ms=${ms}`
			}`,
		);
	}
}
