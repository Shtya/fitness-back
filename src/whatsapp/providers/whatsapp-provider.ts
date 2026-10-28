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
	| {
			type: 'message_receipts';
			providerMessageId: string;
			chatId: string;
			receipts: NormalizedWhatsAppParticipantReceipt[];
	  }
	| { type: 'message_deleted'; providerMessageId: string; mode: 'everyone' }
	/** The sender changed the text / caption of an already delivered message. */
	| {
			type: 'message_edited';
			providerMessageId: string;
			text: string;
			editedAt: Date;
			fromMe: boolean;
	  }
	| { type: 'status_changed' }
	/** Contacts who opened one of our own stories. */
	| {
			type: 'status_receipts';
			statusMessageId: string;
			receipts: NormalizedWhatsAppParticipantReceipt[];
	  }
	/** A story like (heart): someone liking our story, or us liking theirs. Empty emoji = unlike. */
	| {
			type: 'status_like';
			statusMessageId: string;
			actorJid: string | null;
			fromMe: boolean;
			emoji: string;
			at: Date | null;
	  }
	// The linked device was removed / taken over on WhatsApp's side: the stored
	// browser profile can never authenticate again and must be wiped for a rescan.
	| { type: 'session_invalid'; reason: string }
	| { type: 'presence'; payload: any }
	/** A contact's privacy token (tctoken) was stored — their presence can now be subscribed. */
	| { type: 'presence_token'; jids: string[] }
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

export interface NormalizedWhatsAppParticipantReceipt {
	participantJid: string;
	deliveredAt?: Date | null;
	readAt?: Date | null;
	playedAt?: Date | null;
}

export interface WhatsAppSendTextOptions {
	/** Member JIDs referenced as `@<digits>` in the text. */
	mentions?: string[];
}

export interface NormalizedWhatsAppReaction {
	actorKey: string;
	emoji: string;
	timestamp?: Date | null;
}

/** Stored facts about the reacted-to message, for when it is no longer in provider memory. */
export interface WhatsAppReactionTarget {
	chatId?: string | null;
	fromMe?: boolean;
	senderWaId?: string | null;
	rawHint?: any;
}

export interface WhatsAppFetchMessageOptions {
	/** Stop at the first copy this accepts. Default: one that carries a location. */
	accept?: (message: NormalizedWhatsAppMessage | null) => boolean;
	/**
	 * A user opened this message, so the primary phone may be asked for it
	 * (on-demand history, placeholder resend). Background work leaves this false.
	 */
	allowPhoneRequest?: boolean;
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

/** The story a reply answers; the recipient's WhatsApp shows it as a status reply. */
export interface WhatsAppStatusQuote {
	statusMessageId: string;
	providerStatusId?: string | null;
	ownerJid: string;
	type?: string | null;
	caption?: string | null;
}

export interface WhatsAppSendQuoteOptions {
	quotedProviderMessageId?: string;
	embeddedQuote?: WhatsAppEmbeddedQuote;
	statusQuote?: WhatsAppStatusQuote;
}

/** The live socket cannot do this right now (offline) or at all (provider lacks it). */
export class WhatsAppProviderUnavailableError extends Error {
	constructor(
		readonly reason: 'not_connected' | 'unsupported',
		message: string,
	) {
		super(message);
	}
}

export interface WhatsAppNumberCheck {
	/** Digits that were asked about. */
	phoneDigits: string;
	exists: boolean;
	/** Chat id WhatsApp answered with (app form, e.g. `<digits>@c.us`); may differ from the input digits. */
	chatId: string | null;
}

/** Each field says whether WhatsApp gave it, hid it, or the request failed. */
export interface WhatsAppNumberProfile {
	picture: { status: 'available' | 'hidden' | 'error'; url: string | null };
	about: { status: 'available' | 'hidden' | 'error'; text: string | null; setAt: Date | null };
	business:
		| { status: 'not_business' | 'error' }
		| {
				status: 'available';
				description: string | null;
				category: string | null;
				email: string | null;
				websites: string[];
				address: string | null;
		  };
	/** Name the person set on WhatsApp, only known after they messaged / were synced. */
	pushName: string | null;
	/** Name saved for this number in the linked account's WhatsApp contacts. */
	savedName: string | null;
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
	fetchMessage?(
		chatId: string,
		providerMessageId: string,
		options?: WhatsAppFetchMessageOptions,
	): Promise<NormalizedWhatsAppMessage | null>;
	getContacts(): Promise<any[]>;
	/** Re-download the phone address book. Implemented by Baileys only. */
	pullAddressBook?(): Promise<void>;
	resolveContactIdentity?(
		chatId: string,
	): Promise<{ phoneNumber?: string | null; name?: string | null } | null>;
	getProfilePictureUrl?(
		chatId: string,
		options?: { force?: boolean; quality?: 'preview' | 'full' },
	): Promise<string | null>;
	/** Ask WhatsApp's servers whether numbers have an account. Throws when it cannot answer. */
	checkWhatsAppNumbers?(phoneDigits: string[]): Promise<WhatsAppNumberCheck[]>;
	getNumberProfile?(chatId: string): Promise<WhatsAppNumberProfile>;
	/**
	 * Add or rename the contact in the linked account's WhatsApp contact list (app-state
	 * sync). Resolves once WhatsApp's server accepts it; the phone address book copy is
	 * requested, not confirmed.
	 */
	saveContactToWhatsApp?(chatId: string, contact: { fullName: string; firstName?: string | null }): Promise<void>;
	removeContactFromWhatsApp?(chatId: string): Promise<void>;
	getGroups(): Promise<any[]>;
	getGroupParticipants(groupId: string): Promise<any[]>;
	/** The linked account's own JIDs (phone and LID) when the socket knows them. */
	getOwnJids?(): string[];
	sendText(
		chatId: string,
		text: string,
		quote?: string | WhatsAppSendQuoteOptions,
		options?: WhatsAppSendTextOptions,
	): Promise<any>;
	sendContact?(
		chatId: string,
		contact: { displayName: string; phoneNumber: string; waId?: string },
	): Promise<any>;
	/**
	 * Edit one of our sent text messages. `key` is the message key exactly as WhatsApp gave it
	 * (stored in the row's raw); the phone only applies an edit whose key matches the original.
	 */
	editText?(
		providerMessageId: string,
		text: string,
		options?: { key?: { remoteJid?: string; id?: string; participant?: string } | null; chatId?: string | null },
	): Promise<any>;
	markChatUnread?(chatId: string): Promise<any>;
	/** Sends the "delivered" receipts held back by the hold-delivery privacy setting. */
	releaseDeliveryReceipts?(chatId: string): Promise<number>;
	/**
	 * Mute / unmute the chat on WhatsApp itself, so the phone and every linked device stop (or
	 * resume) notifying. `mutedUntil` null with `muted` true means "always".
	 */
	setChatMuted?(chatId: string, muted: boolean, mutedUntil: Date | null): Promise<void>;
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
	sendReaction(
		providerMessageId: string,
		emoji: string | false,
		target?: WhatsAppReactionTarget,
	): Promise<any>;
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
	/**
	 * Resolves `{ data }` (buffer/base64) or, when the provider can stream and
	 * `toFile` is given, `{ filePath }` with the media already written there.
	 */
	downloadMedia(
		providerMessageId: string,
		options?: {
			rawHint?: any;
			toFile?: string;
			/** A user opened this media; the phone may be asked to re-upload it. */
			allowPhoneRequest?: boolean;
		},
	): Promise<any>;
	/** Subscribe to typing/online presence for a chat. */
	subscribePresence?(chatId: string | string[]): Promise<number | void>;
	unsubscribePresence?(chatId: string | string[]): Promise<number | void>;
	sendPresenceUpdate?(
		chatId: string,
		state?: 'composing' | 'recording' | 'paused' | 'available',
	): Promise<void>;
	/**
	 * Account-level availability of this linked device. WhatsApp only pushes
	 * contacts' chatstate (typing / recording) to devices marked available.
	 */
	setOnlinePresence?(online: boolean): Promise<boolean>;
	isOnlinePresence?(): boolean;
	/** Optional: contacts with an unexpired privacy token (presence is only delivered for these). */
	presenceTokenJids?(): Promise<string[]>;
	/** Optional: device-side facts that decide whether contact presence is delivered. */
	presenceDiagnostics?(): {
		providerState: string;
		deviceAvailable: boolean;
		hasPushName: boolean;
		availabilityError?: string | null;
		rawPresencePackets?: number;
		unparsedPresencePackets?: number;
		lastRawPresenceAt?: string | null;
		knownContacts: number;
		lidMappings: number;
	};
	/** Status/story media — may use StatusV3Store; not the same as chat downloadMedia. */
	downloadStatus?(
		providerStatusId: string,
		senderWaId?: string | null,
		options?: { allowPhoneRequest?: boolean },
	): Promise<any>;
	getStatuses(): Promise<any[]>;
	/** Viewers already on our own status in the live session (optional). */
	getOwnStatusReceipts?(
		providerStatusId: string,
		senderWaId?: string | null,
	): Promise<NormalizedWhatsAppParticipantReceipt[]>;
	publishStatus(
		content: string,
		/**
		 * `audienceWaIds` is who the status is encrypted for. A provider that keeps its
		 * own contact list may ignore it; Baileys needs it because its in-memory list is
		 * empty until WhatsApp pushes a sync. `exactAudience` forbids adding anyone else,
		 * and `excludeAudienceWaIds` is removed from whatever the provider would add.
		 */
		options: {
			type: string;
			caption?: string;
			audienceWaIds?: string[];
			exactAudience?: boolean;
			excludeAudienceWaIds?: string[];
		},
	): Promise<any>;
	viewStatus(statusId: string, senderWaId?: string): Promise<any>;
	/** Like (or, with an empty emoji, unlike) someone else's story. */
	likeStatus?(
		statusId: string,
		senderWaId: string | null | undefined,
		emoji: string,
	): Promise<{ ok: boolean }>;
}
