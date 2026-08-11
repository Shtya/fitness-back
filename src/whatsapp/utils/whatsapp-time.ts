/**
 * WhatsApp / WPPConnect timestamps may be unix seconds OR milliseconds.
 * Comparing raw values without normalizing puts "months" (ms) above "hours" (sec).
 */
export function whatsAppTimestampToMs(value: unknown): number | null {
	if (value == null || value === '') return null;
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isNaN(ms) ? null : ms;
	}
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n);
}

export function whatsAppTimestampToDate(value: unknown): Date | null {
	const ms = whatsAppTimestampToMs(value);
	if (ms == null) return null;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return null;
	const now = Date.now();
	// Drop absurd future clocks and pre-WhatsApp-era noise.
	if (ms > now + 24 * 60 * 60 * 1000) return null;
	if (ms < Date.UTC(2009, 0, 1)) return null;
	return date;
}

/** Extract the newest real message timestamp from a provider chat model. */
export function providerChatMessageActivityMs(chat: any): number | null {
	let collectionLast: any;
	try {
		collectionLast = chat?.msgs?.last?.();
	} catch {
		collectionLast = null;
	}
	const collections = [
		chat?.msgs?._models,
		chat?.msgs?.models,
		Array.isArray(chat?.msgs) ? chat.msgs : null,
		chat?.messages,
	];
	const collectionMessages = collections.filter(Array.isArray).flatMap((items) => items.slice(-3));
	const messageCandidates = [
		chat?.lastMessage,
		chat?.lastMsg,
		collectionLast,
		...collectionMessages,
	];
	const actualMessageTimes = messageCandidates
		.flatMap((message) => [
			whatsAppTimestampToDate(message?.t)?.getTime(),
			whatsAppTimestampToDate(message?.timestamp)?.getTime(),
			whatsAppTimestampToDate(message?.providerTimestamp)?.getTime(),
			whatsAppTimestampToDate(message?.messageTimestamp)?.getTime(),
		])
		.filter((value): value is number => Number.isFinite(value));
	if (!actualMessageTimes.length) return null;
	return Math.max(...actualMessageTimes);
}

/**
 * Last activity of a provider chat for inbox ordering.
 * Prefer real message times; ChatModel.t is metadata-only and often jumps for
 * groups (participant updates) before MsgCollection hydrates — that previously
 * floated groups above 1:1 chats and pushed real DMs out of the sync window.
 */
export function providerChatActivityMs(chat: any): number {
	const messageMs = providerChatMessageActivityMs(chat);
	if (messageMs != null) return messageMs;

	// ChatModel.t is only a fallback: provider metadata updates can move it even
	// when the last real message in the conversation is much older.
	return (
		whatsAppTimestampToDate(chat?.t)?.getTime() ||
		whatsAppTimestampToDate(chat?.timestamp)?.getTime() ||
		0
	);
}

/** Two-tier rank: message-backed chats outrank metadata-only chats. */
export function providerChatActivityRank(chat: any): {
	ms: number;
	hasMessage: boolean;
} {
	const messageMs = providerChatMessageActivityMs(chat);
	if (messageMs != null) return { ms: messageMs, hasMessage: true };
	return { ms: providerChatActivityMs(chat), hasMessage: false };
}
