/**
 * Customer typing attempts, built only from real provider chatstate events
 * (Baileys `presence.update` composing / recording / paused). Draft text is
 * never available to linked devices and is never stored.
 *
 * All instants are UTC (`timestamptz`) on the server clock: chatstate nodes
 * carry no timestamp, so message links use the server receive time too.
 */

export type TypingAttemptStatus = 'typing' | 'stopped' | 'sent' | 'no_message';
export type TypingAttemptKind = 'typing' | 'recording';
export type TypingPresenceSignal = TypingAttemptKind | 'stop';

/** Composing again within this gap after a stop continues the same attempt. */
export const TYPING_SESSION_GAP_MS = 60_000;
/** A `typing` row with no refresh for this long is treated as stopped (missed `paused`). */
export const TYPING_STALE_MS = 45_000;
/** Without a message this long after the last typing, the attempt closes as `no_message` (default). */
export const TYPING_MESSAGE_WINDOW_MS = 30 * 60_000;
export const TYPING_WINDOW_DEFAULT_MINUTES = 30;
export const TYPING_WINDOW_MIN_MINUTES = 1;
export const TYPING_WINDOW_MAX_MINUTES = 24 * 60;
/** Per-account override, stored in whatsapp_accounts.provider_capabilities. */
export const TYPING_WINDOW_SETTING_KEY = 'typing.noMessageWindowMinutes';
/** Tolerance for a message persisted just before the composing event was processed. */
export const TYPING_MESSAGE_SKEW_MS = 5_000;
/** Follow-up checkpoints (minutes after the last typing), cut at the account's window. */
export const TYPING_CHECKPOINT_MINUTES = [1, 2, 3, 5, 10, 20, 30, 60, 120, 240, 480, 720, 1440] as const;

export function clampTypingWindowMinutes(value: unknown): number {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return TYPING_WINDOW_DEFAULT_MINUTES;
	return Math.min(TYPING_WINDOW_MAX_MINUTES, Math.max(TYPING_WINDOW_MIN_MINUTES, n));
}

export function typingWindowMinutesFrom(capabilities: Record<string, unknown> | null | undefined): number {
	const raw = capabilities?.[TYPING_WINDOW_SETTING_KEY];
	return raw == null || raw === '' ? TYPING_WINDOW_DEFAULT_MINUTES : clampTypingWindowMinutes(raw);
}

/** SQL: the window in minutes for an account row alias (same rules as typingWindowMinutesFrom). */
export function typingWindowSql(accountAlias: string) {
	const raw = `(${accountAlias}.provider_capabilities->>'${TYPING_WINDOW_SETTING_KEY}')`;
	return `LEAST(${TYPING_WINDOW_MAX_MINUTES}, GREATEST(${TYPING_WINDOW_MIN_MINUTES}, CASE WHEN ${raw} ~ '^[0-9]{1,6}$' THEN ${raw}::int ELSE ${TYPING_WINDOW_DEFAULT_MINUTES} END))`;
}

export function typingCheckpointsFor(windowMinutes = TYPING_WINDOW_DEFAULT_MINUTES): number[] {
	const window = clampTypingWindowMinutes(windowMinutes);
	return [...TYPING_CHECKPOINT_MINUTES.filter((checkpoint) => checkpoint < window), window];
}

export const TYPING_ATTEMPT_STATUSES: TypingAttemptStatus[] = [
	'typing',
	'stopped',
	'sent',
	'no_message',
];

export const TYPING_ATTEMPT_SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS whatsapp_typing_attempts (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		contact_id uuid NULL REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
		chat_id varchar(160) NULL,
		phone varchar(40) NULL,
		kind varchar(12) NOT NULL DEFAULT 'typing',
		status varchar(16) NOT NULL DEFAULT 'typing',
		started_at timestamptz NOT NULL,
		last_typing_at timestamptz NOT NULL,
		stopped_at timestamptz NULL,
		event_count int NOT NULL DEFAULT 1,
		checkpoint_minutes smallint NOT NULL DEFAULT 0,
		message_id uuid NULL REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
		message_at timestamptz NULL,
		superseded_by uuid NULL,
		closed_at timestamptz NULL,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_conversation
		ON whatsapp_typing_attempts (conversation_id, started_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_account_started
		ON whatsapp_typing_attempts (account_id, started_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_open
		ON whatsapp_typing_attempts (status, last_typing_at)
		WHERE status IN ('typing', 'stopped')`,
	`CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_typing_attempts_live
		ON whatsapp_typing_attempts (conversation_id)
		WHERE status = 'typing'`,
	`CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_typing_attempts_message
		ON whatsapp_typing_attempts (message_id)
		WHERE message_id IS NOT NULL`,
];

export function typingPresenceSignal(state: unknown): TypingPresenceSignal | null {
	const value = String(state || '').trim().toLowerCase();
	if (value === 'composing' || value === 'typing') return 'typing';
	if (value === 'recording') return 'recording';
	if (value === 'paused' || value === 'available' || value === 'unavailable') return 'stop';
	return null;
}

export interface TypingAttemptLike {
	id: string;
	status: TypingAttemptStatus;
	startedAt: Date;
	lastTypingAt: Date;
	stoppedAt?: Date | null;
}

export type TypingTransition =
	| { action: 'insert'; supersede: string | null }
	| { action: 'extend'; id: string }
	| { action: 'stop'; id: string }
	| { action: 'noop' };

/**
 * What one chatstate event does to the newest attempt of its conversation.
 * Repeated composing (duplicates, LID + phone aliases) only extends the open row.
 */
export function decideTypingTransition(
	latest: TypingAttemptLike | null,
	signal: TypingPresenceSignal,
	now: Date,
): TypingTransition {
	const open = latest && (latest.status === 'typing' || latest.status === 'stopped') ? latest : null;
	if (signal === 'stop') {
		return open && open.status === 'typing' ? { action: 'stop', id: open.id } : { action: 'noop' };
	}
	if (open) {
		if (open.status === 'typing') return { action: 'extend', id: open.id };
		const lastActivity = Math.max(
			open.lastTypingAt.getTime(),
			open.stoppedAt ? open.stoppedAt.getTime() : 0,
		);
		if (now.getTime() - lastActivity <= TYPING_SESSION_GAP_MS) {
			return { action: 'extend', id: open.id };
		}
		return { action: 'insert', supersede: open.id };
	}
	return { action: 'insert', supersede: null };
}

/**
 * Only the newest attempt of the conversation may own an inbound message, and
 * only while it is still open and inside the account's no-message window.
 */
export function attemptAcceptsMessage(
	latest: TypingAttemptLike | null,
	messageAt: Date,
	windowMs = TYPING_MESSAGE_WINDOW_MS,
): boolean {
	if (!latest) return false;
	if (latest.status !== 'typing' && latest.status !== 'stopped') return false;
	const at = messageAt.getTime();
	if (at < latest.startedAt.getTime() - TYPING_MESSAGE_SKEW_MS) return false;
	return at - latest.lastTypingAt.getTime() <= windowMs;
}

/** Largest checkpoint already reached `elapsedMs` after the last typing. */
export function typingCheckpointFor(elapsedMs: number, windowMinutes = TYPING_WINDOW_DEFAULT_MINUTES): number {
	const minutes = Math.max(0, elapsedMs) / 60_000;
	let reached = 0;
	for (const checkpoint of typingCheckpointsFor(windowMinutes)) {
		if (minutes >= checkpoint) reached = checkpoint;
	}
	return reached;
}

/** Smallest checkpoint that still covers a message `gapMs` after the last typing. */
export function typingSentWithinMinutes(
	gapMs: number,
	windowMinutes = TYPING_WINDOW_DEFAULT_MINUTES,
): number | null {
	const minutes = Math.max(0, gapMs) / 60_000;
	for (const checkpoint of typingCheckpointsFor(windowMinutes)) {
		if (minutes <= checkpoint) return checkpoint;
	}
	return null;
}

/** SQL fragment: checkpoint reached by `ref` (timestamptz) at `now()`, capped at `window` (minutes). */
export function typingCheckpointSql(ref: string, window = String(TYPING_WINDOW_DEFAULT_MINUTES)) {
	const minutes = `EXTRACT(EPOCH FROM (now() - ${ref})) / 60`;
	const cases = [...TYPING_CHECKPOINT_MINUTES]
		.reverse()
		.map((checkpoint) => `WHEN ${minutes} >= ${checkpoint} THEN ${checkpoint}`)
		.join(' ');
	return `(CASE WHEN ${minutes} >= (${window}) THEN (${window}) ELSE (CASE ${cases} ELSE 0 END) END)`;
}

/** SQL fragment: smallest checkpoint covering `gap` (interval), capped at `window` (minutes). */
export function typingSentWithinSql(gap: string, window = String(TYPING_WINDOW_DEFAULT_MINUTES)) {
	const minutes = `EXTRACT(EPOCH FROM (${gap})) / 60`;
	const cases = TYPING_CHECKPOINT_MINUTES.map(
		(checkpoint) => `WHEN ${minutes} <= ${checkpoint} THEN ${checkpoint}`,
	).join(' ');
	return `LEAST((CASE ${cases} ELSE ${TYPING_WINDOW_MAX_MINUTES} END), (${window}))`;
}

const iso = (value: unknown) => {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const ms = (value: unknown) => {
	const at = iso(value);
	return at ? new Date(at).getTime() : null;
};

/** API row (snake_case SQL → camelCase), with derived gaps for the UI. */
export function serializeTypingAttempt(
	row: any,
	now = new Date(),
	fallbackWindowMinutes = TYPING_WINDOW_DEFAULT_MINUTES,
) {
	const windowMinutes =
		row.window_minutes != null ? clampTypingWindowMinutes(row.window_minutes) : fallbackWindowMinutes;
	const startedAt = ms(row.started_at);
	const lastTypingAt = ms(row.last_typing_at);
	const messageAt = ms(row.message_at);
	const status = String(row.status || 'stopped') as TypingAttemptStatus;
	const reference = lastTypingAt ?? startedAt ?? now.getTime();
	const sinceTypingMs = messageAt == null ? Math.max(0, now.getTime() - reference) : null;
	const gapFromLastTypingMs = messageAt != null ? Math.max(0, messageAt - reference) : null;
	return {
		id: String(row.id),
		accountId: String(row.account_id),
		conversationId: String(row.conversation_id),
		contactId: row.contact_id ? String(row.contact_id) : null,
		chatId: row.chat_id || null,
		phone: row.phone || null,
		name: String(row.contact_name || '').trim() || null,
		kind: (row.kind === 'recording' ? 'recording' : 'typing') as TypingAttemptKind,
		status,
		startedAt: iso(row.started_at),
		lastTypingAt: iso(row.last_typing_at),
		stoppedAt: iso(row.stopped_at),
		eventCount: Number(row.event_count || 0),
		checkpointMinutes:
			status === 'typing' || status === 'stopped'
				? typingCheckpointFor(sinceTypingMs ?? 0, windowMinutes)
				: Number(row.checkpoint_minutes || 0),
		messageId: row.message_id ? String(row.message_id) : null,
		messageAt: iso(row.message_at),
		gapFromStartMs: messageAt != null && startedAt != null ? Math.max(0, messageAt - startedAt) : null,
		gapFromLastTypingMs,
		sentWithinMinutes:
			gapFromLastTypingMs != null ? typingSentWithinMinutes(gapFromLastTypingMs, windowMinutes) : null,
		sinceTypingMs,
		windowMinutes,
		superseded: Boolean(row.superseded_by),
		closedAt: iso(row.closed_at),
	};
}

export type SerializedTypingAttempt = ReturnType<typeof serializeTypingAttempt>;

export type TypingAttemptFilter = 'all' | 'typing' | 'sent' | 'no_message' | 'waiting';

export function normalizeTypingAttemptFilter(value: unknown): TypingAttemptFilter {
	const v = String(value || '').trim().toLowerCase();
	return v === 'typing' || v === 'sent' || v === 'no_message' || v === 'waiting' ? v : 'all';
}

/** `watching` (default): online only while a CRM user has the inbox open. */
export type OnlinePresenceMode = 'watching' | 'always' | 'off';

export function onlinePresenceMode(value: unknown): OnlinePresenceMode {
	const v = String(value || '').trim().toLowerCase();
	if (v === 'always' || v === 'on' || v === 'true') return 'always';
	if (v === 'off' || v === 'false' || v === 'never') return 'off';
	return 'watching';
}

export function desiredOnlinePresence(mode: OnlinePresenceMode, watchers: number) {
	if (mode === 'always') return true;
	if (mode === 'off') return false;
	return watchers > 0;
}
