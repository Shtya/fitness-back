import { redactMessagesRawForClient } from './whatsapp-raw-redact';
import { isWhatsAppViewOnceRaw, stripViewOnceRawPreview } from './whatsapp-view-once';

export type WhatsAppClientUser = { id: string; name: string | null; role: string | null };

/** Staff relations leave the API as a display summary only — never the full User row. */
export function toWhatsAppClientUser(user: unknown): WhatsAppClientUser | null {
	if (!user || typeof user !== 'object') return null;
	const source = user as { id?: string; name?: string | null; role?: string | null };
	if (!source.id) return null;
	return { id: source.id, name: source.name ?? null, role: source.role ?? null };
}

/** Mutates and returns `messages`; pass a shallow copy when the entity is persisted afterwards. */
export function prepareMessagesForClient<
	T extends { raw?: unknown; attachments?: any; senderUser?: unknown },
>(messages: T[]): T[] {
	for (const message of messages || []) {
		if (!message || !isWhatsAppViewOnceRaw(message.raw)) continue;
		const target = message as T & {
			isViewOnce?: boolean;
			raw?: unknown;
			attachments?: any;
			text?: string | null;
		};
		target.isViewOnce = true;
		target.text = null;
		target.raw = stripViewOnceRawPreview(target.raw);
		if (Array.isArray(target.attachments)) {
			target.attachments = target.attachments.map((attachment: any) => {
				if (!attachment || typeof attachment !== 'object') return attachment;
				const { previewDataUrl: _preview, thumbnailUrl: _thumb, ...rest } = attachment;
				return { ...rest, viewOnce: true };
			});
		}
	}
	redactMessagesRawForClient(messages);
	for (const message of messages || []) {
		if (message && message.senderUser !== undefined) {
			(message as { senderUser?: unknown }).senderUser = toWhatsAppClientUser(message.senderUser);
		}
	}
	return messages;
}
