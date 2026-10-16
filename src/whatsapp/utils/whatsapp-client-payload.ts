import { redactMessagesRawForClient } from './whatsapp-raw-redact';
import { resolveOutgoingDisplayFileName } from './whatsapp-display-file-name';
import {
	isWhatsAppViewOnceRaw,
	stripViewOnceQuotedPreviews,
	stripViewOnceRawPreview,
} from './whatsapp-view-once';

export type WhatsAppClientUser = { id: string; name: string | null; role: string | null };

/** Staff relations leave the API as a display summary only — never the full User row. */
export function toWhatsAppClientUser(user: unknown): WhatsAppClientUser | null {
	if (!user || typeof user !== 'object') return null;
	const source = user as { id?: string; name?: string | null; role?: string | null };
	if (!source.id) return null;
	return { id: source.id, name: source.name ?? null, role: source.role ?? null };
}

/** A reply to view-once media must not carry its caption or thumbnail in the quote. */
function hideViewOnceReplyPreview(message: { raw?: unknown }) {
	const target = message as { raw?: unknown; replyTo?: Record<string, unknown> | null };
	const raw = stripViewOnceQuotedPreviews(target.raw);
	const quotedViewOnce = raw !== target.raw;
	if (quotedViewOnce) target.raw = raw;
	const replyTo = target.replyTo;
	if (!replyTo || typeof replyTo !== 'object') return;
	if (!quotedViewOnce && replyTo.isViewOnce !== true && replyTo.type !== 'view_once') return;
	target.replyTo = { ...replyTo, isViewOnce: true, text: null, previewDataUrl: null };
}

/**
 * Rows sent before original names were forwarded to `sendMedia` stored the internal
 * storage name (`share_<ms>_<hex>_…`, `<ms>-<rand>.ext`). Show the original part only.
 * Voice notes keep theirs: the `voice-<n>s` tag carries the duration.
 */
function withOriginalFileName(attachment: any) {
	if (!attachment || typeof attachment !== 'object' || !attachment.fileName) return attachment;
	const type = String(attachment.type || '').toLowerCase();
	if (type === 'ptt' || type === 'voice' || /voice-\d/i.test(attachment.fileName)) return attachment;
	// Always resolve: strips internal storage names and repairs Multer latin1 mojibake.
	const fileName = resolveOutgoingDisplayFileName({
		requested: attachment.fileName,
		storagePath: attachment.fileName,
		type,
	});
	return fileName === attachment.fileName ? attachment : { ...attachment, fileName };
}

/** Mutates and returns `messages`; pass a shallow copy when the entity is persisted afterwards. */
export function prepareMessagesForClient<
	T extends { raw?: unknown; attachments?: any; senderUser?: unknown },
>(messages: T[]): T[] {
	for (const message of messages || []) {
		if (message) hideViewOnceReplyPreview(message);
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
		if (message && Array.isArray(message.attachments)) {
			const renamed = message.attachments.map(withOriginalFileName);
			if (renamed.some((item: unknown, index: number) => item !== message.attachments[index])) {
				message.attachments = renamed;
			}
		}
		if (message && message.senderUser !== undefined) {
			(message as { senderUser?: unknown }).senderUser = toWhatsAppClientUser(message.senderUser);
		}
	}
	return messages;
}
