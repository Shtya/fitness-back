export type WhatsAppProviderEvent =
	| { type: 'qr'; qr: string }
	| { type: 'pairing_code'; code: string }
	| {
			type: 'connection';
			status: string;
			phoneNumber?: string;
			error?: string;
	  }
	| { type: 'message'; message: NormalizedWhatsAppMessage }
	| { type: 'message_status'; providerMessageId: string; status: string }
	| {
			type: 'message_reactions';
			providerMessageId: string;
			reactions: NormalizedWhatsAppReaction[];
	  }
	| { type: 'message_deleted'; providerMessageId: string; mode: 'everyone' }
	| { type: 'status_changed' }
	// The linked device was removed / taken over on WhatsApp's side: the stored
	// browser profile can never authenticate again and must be wiped for a rescan.
	| { type: 'session_invalid'; reason: string }
	| { type: 'presence'; payload: any };

export interface NormalizedWhatsAppAttachment {
	type: string;
	mimeType?: string | null;
	fileName?: string | null;
	fileSizeBytes?: number | null;
	providerMediaId?: string | null;
}

export interface NormalizedWhatsAppReaction {
	actorKey: string;
	emoji: string;
	timestamp?: Date | null;
}

export interface NormalizedWhatsAppMessage {
	providerMessageId: string;
	chatId: string;
	senderWaId?: string | null;
	fromMe: boolean;
	type: string;
	text?: string | null;
	timestamp: Date;
	/** False when provider omitted/invalid time — must not drive inbox ordering. */
	timestampReliable?: boolean;
	quotedProviderMessageId?: string | null;
	isForwarded?: boolean;
	isStarred?: boolean;
	contactName?: string | null;
	attachments?: NormalizedWhatsAppAttachment[];
	raw?: any;
}

export interface WhatsAppProviderCapabilities {
	qr: boolean;
	history: boolean;
	contacts: boolean;
	groups: boolean;
	groupParticipants: boolean;
	mediaDownload: boolean;
	statusFetch: boolean;
	statusPublish: boolean;
	statusView: boolean;
	reactions: boolean;
	messageActions: boolean;
}

export interface WhatsAppProvider {
	readonly name: string;
	readonly capabilities: WhatsAppProviderCapabilities;
	connect(phoneNumber?: string): Promise<void>;
	disconnect(): Promise<void>;
	logout(): Promise<void>;
	getQr(): string | null;
	getPairingCode(): string | null;
	getState(): string;
	/** Remaining ms before chat history sync should be attempted again (0 = ready). */
	getChatStoreCooldownMs?(): number;
	/** Clear history-sync cooldown (e.g. empty chat must retry). */
	resetChatStoreCooldown?(): void;
	/** True when WhatsApp Web ChatStore has at least one chat model loaded. */
	isChatStoreHydrated?(): Promise<boolean>;
	/**
	 * True when WhatsApp Web MAIN UI can serve chat history.
	 * Prefer a fast probe — callers should fail soft when false instead of hanging.
	 */
	isHistoryReady?(): Promise<boolean>;
	onEvent(listener: (event: WhatsAppProviderEvent) => void | Promise<void>): void;
	getChats(limit?: number): Promise<any[]>;
	getMessages(
		chatId: string,
		options?: {
			limit?: number;
			before?: string;
			after?: string;
			/** Extra JIDs to try (e.g. phone @c.us for a @lid conversation). */
			aliases?: string[];
		},
	): Promise<NormalizedWhatsAppMessage[]>;
	getContacts(): Promise<any[]>;
	resolveContactIdentity?(
		chatId: string,
	): Promise<{ phoneNumber?: string | null; name?: string | null } | null>;
	getGroups(): Promise<any[]>;
	getGroupParticipants(groupId: string): Promise<any[]>;
	sendText(chatId: string, text: string, quotedProviderMessageId?: string): Promise<any>;
	sendMedia(
		chatId: string,
		path: string,
		options?: {
			caption?: string;
			fileName?: string;
			isVoice?: boolean;
			mimeType?: string | null;
			quotedProviderMessageId?: string;
		},
	): Promise<any>;
	sendReaction(providerMessageId: string, emoji: string | false): Promise<any>;
	getReactions(providerMessageId: string): Promise<NormalizedWhatsAppReaction[]>;
	forwardMessage(chatId: string, providerMessageId: string): Promise<any>;
	deleteMessage(
		chatId: string,
		providerMessageId: string,
		mode: 'local' | 'everyone',
	): Promise<any>;
	starMessage(providerMessageId: string, starred: boolean): Promise<any>;
	pinMessage(providerMessageId: string, pinned: boolean): Promise<any>;
	getMessageInfo(providerMessageId: string): Promise<any>;
	markChatRead(chatId: string): Promise<any>;
	downloadMedia(providerMessageId: string): Promise<any>;
	/** Subscribe to typing/online presence for a chat (WppConnect). */
	subscribePresence?(chatId: string | string[]): Promise<number | void>;
	unsubscribePresence?(chatId: string | string[]): Promise<number | void>;
	/** Status/story media — may use StatusV3Store; not the same as chat downloadMedia. */
	downloadStatus?(providerStatusId: string, senderWaId?: string | null): Promise<any>;
	getStatuses(): Promise<any[]>;
	publishStatus(content: string, options: { type: string; caption?: string }): Promise<any>;
	viewStatus(statusId: string, senderWaId?: string): Promise<any>;
}
