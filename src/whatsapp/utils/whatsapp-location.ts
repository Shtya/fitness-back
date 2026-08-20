export type WhatsAppLocationPayload = {
	latitude: number;
	longitude: number;
	name?: string | null;
	address?: string | null;
	comment?: string | null;
	url?: string | null;
	isLive?: boolean;
	previewDataUrl?: string | null;
};

export function toCoord(value: unknown): number | null {
	if (value == null || value === '') return null;
	if (typeof value === 'object') {
		const record = value as {
			toNumber?: () => number;
			value?: unknown;
			low?: unknown;
			high?: unknown;
			unsigned?: unknown;
		};
		if (typeof record.toNumber === 'function') {
			const n = Number(record.toNumber());
			return Number.isFinite(n) ? n : null;
		}
		if (record.value != null && record.value !== value) return toCoord(record.value);
		if (record.low != null || record.high != null) {
			const low = Number(record.low) || 0;
			const high = Number(record.high) || 0;
			if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
			const n = high * 0x100000000 + (low >>> 0);
			return Number.isFinite(n) ? n : null;
		}
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function unwrapBaileysContent(message: any): any {
	if (!message || typeof message !== 'object') return message;
	return (
		message.ephemeralMessage?.message ||
		message.viewOnceMessage?.message ||
		message.viewOnceMessageV2?.message ||
		message.viewOnceMessageV2Extension?.message ||
		message.documentWithCaptionMessage?.message ||
		message.editedMessage?.message ||
		message
	);
}

function jpegThumbnailToDataUrl(thumb: any): string | null {
	if (thumb == null) return null;
	if (typeof thumb === 'string' && thumb.length) {
		if (thumb.startsWith('data:')) return thumb;
		return `data:image/jpeg;base64,${thumb}`;
	}
	if (Buffer.isBuffer(thumb) && thumb.length) {
		return `data:image/jpeg;base64,${thumb.toString('base64')}`;
	}
	if (thumb?.type === 'Buffer' && Array.isArray(thumb.data) && thumb.data.length) {
		return `data:image/jpeg;base64,${Buffer.from(thumb.data).toString('base64')}`;
	}
	return null;
}

function locationFromNode(node: any, isLive = false): WhatsAppLocationPayload | null {
	if (!node || typeof node !== 'object') return null;
	const latitude = toCoord(node.degreesLatitude ?? node.latitude ?? node.lat);
	const longitude = toCoord(node.degreesLongitude ?? node.longitude ?? node.lng ?? node.lon);
	if (latitude == null || longitude == null) return null;
	if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
	const name = String(node.name || node.caption || node.loc || '').trim() || null;
	const address = String(node.address || '').trim() || null;
	const comment = String(node.comment || '').trim() || null;
	const url = String(node.url || '').trim() || null;
	return {
		latitude,
		longitude,
		name,
		address,
		comment,
		url,
		isLive,
		previewDataUrl: jpegThumbnailToDataUrl(node.jpegThumbnail || node.previewDataUrl),
	};
}

export function extractWhatsAppLocation(source: any): WhatsAppLocationPayload | null {
	if (!source || typeof source !== 'object') return null;
	const direct = locationFromNode(source.location, Boolean(source.location?.isLive));
	if (direct) {
		return {
			...direct,
			isLive: Boolean(source.location?.isLive) || direct.isLive,
			previewDataUrl: direct.previewDataUrl || source.location?.previewDataUrl || null,
		};
	}

	const raw = source.raw && typeof source.raw === 'object' ? source.raw : source;
	const stored = locationFromNode(raw.location, Boolean(raw.location?.isLive));
	if (stored) {
		return {
			...stored,
			isLive: Boolean(raw.location?.isLive) || stored.isLive,
			previewDataUrl: stored.previewDataUrl || raw.location?.previewDataUrl || null,
		};
	}
	const content = unwrapBaileysContent(raw.message || raw);
	if (content?.liveLocationMessage) {
		const live = locationFromNode(content.liveLocationMessage, true);
		if (live) return live;
	}
	if (content?.locationMessage) {
		const pinned = locationFromNode(content.locationMessage, false);
		if (pinned) return pinned;
	}

	const type = String(source.type || raw.type || '').toLowerCase();
	return locationFromNode(raw, type === 'live_location' || type === 'livelocation');
}

export function mergeLocationIntoRaw(
	raw: Record<string, any> | null | undefined,
	location: WhatsAppLocationPayload | null | undefined,
) {
	if (!location) return raw || null;
	const base = raw && typeof raw === 'object' ? { ...raw } : {};
	base.location = {
		latitude: location.latitude,
		longitude: location.longitude,
		name: location.name || null,
		address: location.address || null,
		comment: location.comment || null,
		url: location.url || null,
		isLive: Boolean(location.isLive),
		previewDataUrl: location.previewDataUrl || null,
	};
	return base;
}
