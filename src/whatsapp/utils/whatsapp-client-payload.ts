import { redactMessagesRawForClient } from './whatsapp-raw-redact';

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
	redactMessagesRawForClient(messages);
	for (const message of messages || []) {
		if (message && message.senderUser !== undefined) {
			(message as { senderUser?: unknown }).senderUser = toWhatsAppClientUser(message.senderUser);
		}
	}
	return messages;
}
