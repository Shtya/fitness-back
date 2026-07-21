export type WhatsAppProviderEvent =
	| { type: 'qr'; qr: string }
	| { type: 'connection'; status: string; phoneNumber?: string }
	| { type: 'message'; message: NormalizedWhatsAppMessage }
	| { type: 'message_status'; providerMessageId: string; status: string }
	| {
			type: 'message_reactions';
			providerMessageId: string;
			reactions: NormalizedWhatsAppReaction[];
	  }
	| { type: 'message_deleted'; providerMessageId: string; mode: 'everyone' }
	| { type: 'status_changed' }
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
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	logout(): Promise<void>;
	getQr(): string | null;
	getState(): string;
	onEvent(listener: (event: WhatsAppProviderEvent) => void | Promise<void>): void;
	getChats(limit?: number): Promise<any[]>;
	getMessages(
		chatId: string,
		options?: { limit?: number; before?: string; after?: string },
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
	/** Status/story media — may use StatusV3Store; not the same as chat downloadMedia. */
	downloadStatus?(providerStatusId: string, senderWaId?: string | null): Promise<any>;
	getStatuses(): Promise<any[]>;
	publishStatus(content: string, options: { type: string; caption?: string }): Promise<any>;
	viewStatus(statusId: string, senderWaId?: string): Promise<any>;
}
