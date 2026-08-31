export type WhatsAppProviderEvent =
	| { type: 'qr'; qr: string }
	| { type: 'pairing_code'; code: string }
	| {
			type: 'connection';
			status: string;
			phoneNumber?: string;
			error?: string;
			reason?: string;
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
	| { type: 'presence'; payload: any }
	| {
			type: 'history_sync';
			chats: number;
			messages: number;
			payload?: NormalizedWhatsAppMessage[];
	  }
	| { type: 'chat_unread'; chatId: string; unreadCount: number };

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
	location?: {
		latitude: number;
		longitude: number;
		name?: string | null;
		address?: string | null;
		comment?: string | null;
		url?: string | null;
		isLive?: boolean;
		previewDataUrl?: string | null;
	} | null;
	raw?: any;
}

/** Embedded quote content for cross-chat resend (share-as-original with reply). */
export interface WhatsAppEmbeddedQuote {
	text?: string | null;
	type?: string;
	senderName?: string | null;
	durationSeconds?: number | null;
}

export interface WhatsAppSendQuoteOptions {
	quotedProviderMessageId?: string;
	embeddedQuote?: WhatsAppEmbeddedQuote;
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
			/** Pull older history from the phone. Open-chat must leave this false. */
			loadEarlier?: boolean;
		},
	): Promise<NormalizedWhatsAppMessage[]>;
	findMessage?(providerMessageId: string): NormalizedWhatsAppMessage | null;
	/** Fetch a chat message from the live provider (RAM first, then WhatsApp). */
	fetchMessage?(chatId: string, providerMessageId: string): Promise<NormalizedWhatsAppMessage | null>;
	getContacts(): Promise<any[]>;
	resolveContactIdentity?(
		chatId: string,
	): Promise<{ phoneNumber?: string | null; name?: string | null } | null>;
	getProfilePictureUrl?(chatId: string): Promise<string | null>;
	getGroups(): Promise<any[]>;
	getGroupParticipants(groupId: string): Promise<any[]>;
	sendText(
		chatId: string,
		text: string,
		quote?: string | WhatsAppSendQuoteOptions,
	): Promise<any>;
	sendContact?(
		chatId: string,
		contact: { displayName: string; phoneNumber: string; waId?: string },
	): Promise<any>;
	editText?(providerMessageId: string, text: string): Promise<any>;
	markChatUnread?(chatId: string): Promise<any>;
	sendMedia(
		chatId: string,
		path: string,
		options?: {
			caption?: string;
			fileName?: string;
			isVoice?: boolean;
			isSticker?: boolean;
			mimeType?: string | null;
			/** Sync layer already converted to WhatsApp OGG/Opus — skip provider re-encode. */
			voiceAlreadyConverted?: boolean;
			quotedProviderMessageId?: string;
			embeddedQuote?: WhatsAppEmbeddedQuote;
		},
	): Promise<any>;
	sendReaction(providerMessageId: string, emoji: string | false): Promise<any>;
	getReactions(providerMessageId: string): Promise<NormalizedWhatsAppReaction[]>;
	forwardMessage(chatId: string, providerMessageId: string, options?: { rawHint?: any }): Promise<any>;
	deleteMessage(
		chatId: string,
		providerMessageId: string,
		mode: 'local' | 'everyone',
	): Promise<any>;
	starMessage(providerMessageId: string, starred: boolean): Promise<any>;
	pinMessage(providerMessageId: string, pinned: boolean): Promise<any>;
	getMessageInfo(providerMessageId: string): Promise<any>;
	markChatRead(chatId: string): Promise<any>;
	downloadMedia(
		providerMessageId: string,
		options?: { rawHint?: any },
	): Promise<any>;
	/** Subscribe to typing/online presence for a chat. */
	subscribePresence?(chatId: string | string[]): Promise<number | void>;
	unsubscribePresence?(chatId: string | string[]): Promise<number | void>;
	sendPresenceUpdate?(
		chatId: string,
		state?: 'composing' | 'recording' | 'paused' | 'available',
	): Promise<void>;
	/** Status/story media — may use StatusV3Store; not the same as chat downloadMedia. */
	downloadStatus?(providerStatusId: string, senderWaId?: string | null): Promise<any>;
	getStatuses(): Promise<any[]>;
	publishStatus(content: string, options: { type: string; caption?: string }): Promise<any>;
	viewStatus(statusId: string, senderWaId?: string): Promise<any>;
}
