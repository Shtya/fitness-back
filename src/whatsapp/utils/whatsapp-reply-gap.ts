/**
 * "Reply time difference" for delayed replies: how long the other side took to answer my last
 * message. All times are absolute instants (UTC), so the result does not depend on time zones.
 */
export type ReplyGapMessage = {
	direction: 'inbound' | 'outbound' | string;
	providerTimestamp: Date | string;
};

export type ReplyGap =
	| {
			ok: true;
			/** My last message before their reply. */
			myMessageAt: string;
			/** Their first message after it: the moment they replied. */
			theirReplyAt: string;
			/** Their latest message: delayed replies count from here. */
			theirLastAt: string;
			gapMs: number;
	  }
	| { ok: false; reason: 'no_reply' | 'no_my_message' };

const time = (value: Date | string) => new Date(value).getTime();

/** `messages` are the valid messages of one chat, newest first. */
export function computeReplyGap(messages: ReplyGapMessage[]): ReplyGap {
	const rows = messages.filter(row => Number.isFinite(time(row.providerTimestamp)));
	const lastInboundIndex = rows.findIndex(row => row.direction === 'inbound');
	if (lastInboundIndex < 0) return { ok: false, reason: 'no_reply' };
	const myIndex = rows.findIndex((row, index) => index > lastInboundIndex && row.direction === 'outbound');
	if (myIndex < 0) return { ok: false, reason: 'no_my_message' };
	// Everything between my message and their latest one is theirs (my message is the newest of mine
	// before it), so their first reply is the oldest inbound just above my message.
	let replyIndex = lastInboundIndex;
	for (let index = myIndex - 1; index > lastInboundIndex; index -= 1) {
		if (rows[index].direction === 'inbound') {
			replyIndex = index;
			break;
		}
	}
	const myAt = time(rows[myIndex].providerTimestamp);
	const replyAt = time(rows[replyIndex].providerTimestamp);
	return {
		ok: true,
		myMessageAt: new Date(myAt).toISOString(),
		theirReplyAt: new Date(replyAt).toISOString(),
		theirLastAt: new Date(time(rows[lastInboundIndex].providerTimestamp)).toISOString(),
		gapMs: Math.max(0, replyAt - myAt),
	};
}
