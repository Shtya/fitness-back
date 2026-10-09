/**
 * Normalize WhatsApp message acknowledgement info for the CRM Message info UI.
 * Compatible with the WPPConnect `getMessageACK` remaining-count shape and
 * Baileys status ranks (pending → sent → delivered → read → played).
 */

export type WhatsAppMessageAckInfo = {
	deliveryRemaining: number | null;
	readRemaining: number | null;
	playedRemaining: number | null;
	delivered: boolean;
	read: boolean;
	played: boolean;
	status: string;
	statusUpdatedAt: string | null;
	source: 'provider' | 'status' | 'none';
};

const ACK_RANK: Record<string, number> = {
	pending: 0,
	sent: 1,
	delivered: 2,
	read: 3,
	played: 4,
};

export function normalizeWhatsAppAckStatus(status?: string | null): string {
	const value = String(status || '')
		.toLowerCase()
		.trim();
	if (value === 'failed' || value === 'error') return 'failed';
	if (value in ACK_RANK) return value;
	return 'pending';
}

export function buildWhatsAppMessageAckInfo(input: {
	status?: string | null;
	statusUpdatedAt?: Date | string | null;
	fromMe?: boolean;
	acknowledgements?: Partial<{
		deliveryRemaining: number | null;
		readRemaining: number | null;
		playedRemaining: number | null;
	}> | null;
}): WhatsAppMessageAckInfo {
	const status = normalizeWhatsAppAckStatus(input.status);
	const updatedAt = input.statusUpdatedAt
		? new Date(input.statusUpdatedAt).toISOString()
		: null;
	const ack = input.acknowledgements || null;

	const hasAckCounts =
		ack &&
		(ack.deliveryRemaining != null ||
			ack.readRemaining != null ||
			ack.playedRemaining != null);

	if (hasAckCounts) {
		const delivered =
			ack!.deliveryRemaining === 0 ||
			ack!.readRemaining === 0 ||
			ack!.playedRemaining === 0 ||
			(ACK_RANK[status] ?? 0) >= 2;
		const read =
			ack!.readRemaining === 0 ||
			ack!.playedRemaining === 0 ||
			(ACK_RANK[status] ?? 0) >= 3;
		const played = ack!.playedRemaining === 0 || (ACK_RANK[status] ?? 0) >= 4;
		return {
			deliveryRemaining: ack!.deliveryRemaining ?? (delivered ? 0 : 1),
			readRemaining: ack!.readRemaining ?? (read ? 0 : 1),
			playedRemaining: ack!.playedRemaining ?? (played ? 0 : 1),
			delivered,
			read,
			played,
			status,
			statusUpdatedAt: updatedAt,
			source: 'provider',
		};
	}

	// Inbound messages do not have outbound delivery/read receipts.
	if (input.fromMe === false) {
		return {
			deliveryRemaining: null,
			readRemaining: null,
			playedRemaining: null,
			delivered: false,
			read: false,
			played: false,
			status,
			statusUpdatedAt: updatedAt,
			source: 'none',
		};
	}

	const rank = ACK_RANK[status] ?? 0;
	const delivered = rank >= 2;
	const read = rank >= 3;
	const played = rank >= 4;
	return {
		deliveryRemaining: delivered ? 0 : 1,
		readRemaining: read ? 0 : 1,
		playedRemaining: played ? 0 : 1,
		delivered,
		read,
		played,
		status,
		statusUpdatedAt: updatedAt,
		source: status && status !== 'pending' ? 'status' : 'none',
	};
}

/**
 * Local facts for an *inbound* message (they sent → we received).
 *
 * WhatsApp does **not** expose the sender's tick UI (✓ / ✓✓ / blue) to the
 * recipient. Never invent "they see double grey/blue" just because the CRM
 * has the row — a message can sit in our DB while their phone still shows ✓.
 *
 * We only confirm:
 * - sent: we know they sent it (we have providerTimestamp / the message)
 * - arrivedLocally: it is present on our side (CRM/device sync time)
 * - readLocally: our unread window no longer includes this message
 * - theirDelivered / theirRead: always unknown from protocol (false here)
 */
export type InboundSenderReceiptView = {
	sent: boolean;
	/** Always false — we cannot observe their delivery tick. */
	delivered: boolean;
	/** Always false — we cannot observe their read tick. */
	read: boolean;
	sentAt: string | null;
	/** When the message appeared on our side (local fact, not their ✓✓). */
	arrivedLocallyAt: string | null;
	readLocally: boolean;
	readAt: string | null;
	status: 'sent' | 'unknown';
	readReceiptsEnabled: boolean;
	stillUnreadLocally: boolean;
	source: 'local';
};

export function buildInboundSenderReceiptView(input: {
	sentAt?: Date | string | null;
	/** When the message first appeared on our side (device/CRM). */
	receivedAt?: Date | string | null;
	/** True when this inbound message is still inside the conversation unread window. */
	stillUnreadLocally?: boolean;
	/** Account privacy: if 'never', we never send blue ticks to them. */
	readReceiptsEnabled?: boolean;
	readAt?: Date | string | null;
}): InboundSenderReceiptView {
	const toIso = (value?: Date | string | null) => {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	};
	const sentAt = toIso(input.sentAt);
	const arrivedLocallyAt = toIso(input.receivedAt) || sentAt;
	const stillUnreadLocally = Boolean(input.stillUnreadLocally);
	const readReceiptsEnabled = input.readReceiptsEnabled !== false;
	const sent = Boolean(sentAt || arrivedLocallyAt);
	const readLocally = sent && !stillUnreadLocally;
	return {
		sent,
		delivered: false,
		read: false,
		sentAt,
		arrivedLocallyAt,
		readLocally,
		readAt: readLocally ? toIso(input.readAt) || arrivedLocallyAt : null,
		status: sent ? 'sent' : 'unknown',
		readReceiptsEnabled,
		stillUnreadLocally,
		source: 'local',
	};
}
