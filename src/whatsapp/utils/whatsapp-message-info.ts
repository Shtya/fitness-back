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
