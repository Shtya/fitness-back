import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	WhatsAppConversation,
	WhatsAppConversationType,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { resolveWhatsAppContactLabel } from '../utils/whatsapp-contact-name';

export type OnlineContactPresence = {
	accountId: string;
	conversationId: string;
	chatId: string;
	name: string;
	phoneNumber: string | null;
	state: string;
	online: true;
	typing: boolean;
	recording: boolean;
	lastSeen: number;
	updatedAt: number;
};

/**
 * Tracks WhatsApp *contact* presence (customers online in WhatsApp),
 * not CRM staff sockets. Fed by Baileys/WPP `presence.update` events.
 */
@Injectable()
export class WhatsAppContactPresenceService {
	private readonly logger = new Logger(WhatsAppContactPresenceService.name);
	/** `${accountId}:${conversationId}` → live contact presence */
	private readonly byConversation = new Map<string, OnlineContactPresence>();
	private readonly lastSubscribeAt = new Map<string, number>();
	private readonly subscribeInFlight = new Set<string>();

	constructor(
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly gateway: WhatsAppGateway,
	) {}

	private key(accountId: string, conversationId: string) {
		return `${accountId}:${conversationId}`;
	}

	private isDirectChat(conversation: WhatsAppConversation) {
		const chatId = String(conversation.providerChatId || '').toLowerCase();
		if (!chatId) return false;
		if (conversation.type === WhatsAppConversationType.GROUP) return false;
		if (chatId.endsWith('@g.us')) return false;
		if (chatId.includes('@newsletter')) return false;
		if (chatId.includes('@broadcast')) return false;
		if (chatId.includes('status@')) return false;
		if (chatId.includes('email-memo')) return false;
		return true;
	}

	private displayName(conversation: WhatsAppConversation, fallback = '') {
		const contact = conversation.contact;
		const label = resolveWhatsAppContactLabel({
			savedName: contact?.name,
			phone: contact?.phoneNumber,
			chatId: conversation.providerChatId,
		});
		return String(
			label || fallback || contact?.phoneNumber || conversation.providerChatId || 'Contact',
		).trim();
	}

	applyPresenceEvent(
		accountId: string,
		conversation: WhatsAppConversation,
		payload: {
			state?: string;
			isOnline?: boolean;
			typing?: boolean;
			recording?: boolean;
			lastSeen?: number;
			t?: number;
		},
	) {
		if (!this.isDirectChat(conversation)) return;
		const conversationId = String(conversation.id);
		const mapKey = this.key(accountId, conversationId);
		const state = String(payload?.state || 'unavailable').toLowerCase();
		const typing = state === 'composing' || Boolean(payload?.typing);
		const recording = state === 'recording' || Boolean(payload?.recording);
		const online =
			Boolean(payload?.isOnline) ||
			state === 'available' ||
			state === 'composing' ||
			state === 'recording';

		if (!online) {
			if (this.byConversation.delete(mapKey)) {
				this.broadcast(accountId);
			}
			return;
		}

		const next: OnlineContactPresence = {
			accountId,
			conversationId,
			chatId: String(conversation.providerChatId || ''),
			name: this.displayName(conversation),
			phoneNumber: conversation.contact?.phoneNumber || null,
			state,
			online: true,
			typing,
			recording,
			lastSeen: Number(payload?.lastSeen || 0) || 0,
			updatedAt: Number(payload?.t) || Date.now(),
		};
		const prev = this.byConversation.get(mapKey);
		this.byConversation.set(mapKey, next);
		if (
			!prev ||
			prev.name !== next.name ||
			prev.state !== next.state ||
			prev.typing !== next.typing ||
			prev.recording !== next.recording
		) {
			this.broadcast(accountId);
		}
	}

	clearAccount(accountId: string) {
		let changed = false;
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId === accountId) {
				this.byConversation.delete(mapKey);
				changed = true;
			}
		}
		this.lastSubscribeAt.delete(accountId);
		if (changed) this.broadcast(accountId);
	}

	listOnline(accountId: string, maxAgeMs = 90_000) {
		const now = Date.now();
		const items: OnlineContactPresence[] = [];
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId !== accountId) continue;
			if (now - entry.updatedAt > maxAgeMs) {
				this.byConversation.delete(mapKey);
				continue;
			}
			items.push(entry);
		}
		items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
		return {
			accountId,
			items,
			at: new Date().toISOString(),
		};
	}

	private broadcast(accountId: string) {
		const snapshot = this.listOnline(accountId);
		this.gateway.emitAccountEvent(accountId, 'online_contacts', snapshot);
	}

	/**
	 * Ask WhatsApp to stream presence for recent 1:1 inbox chats.
	 * Without this, only opened chats get updates (via listMessages subscribe).
	 */
	async subscribeRecentDirectChats(accountId: string, limit = 120, force = false) {
		const last = this.lastSubscribeAt.get(accountId) || 0;
		if (!force && Date.now() - last < 45_000) return { ok: true, subscribed: 0, skipped: true };
		if (this.subscribeInFlight.has(accountId)) return { ok: true, subscribed: 0, skipped: true };
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected' || !provider.subscribePresence) {
			return { ok: false, subscribed: 0 };
		}

		this.subscribeInFlight.add(accountId);
		try {
			const rows = await this.conversationRepo
				.createQueryBuilder('conversation')
				.leftJoinAndSelect('conversation.contact', 'contact')
				.where('conversation.accountId = :accountId', { accountId })
				.andWhere('conversation.type = :type', { type: WhatsAppConversationType.DIRECT })
				.andWhere('LOWER(conversation.providerChatId) NOT LIKE :newsletter', {
					newsletter: '%@newsletter%',
				})
				.andWhere('LOWER(conversation.providerChatId) NOT LIKE :broadcast', {
					broadcast: '%@broadcast%',
				})
				.andWhere('LOWER(conversation.providerChatId) NOT LIKE :status', {
					status: '%status@%',
				})
				.andWhere('LOWER(conversation.providerChatId) NOT LIKE :memo', {
					memo: '%email-memo%',
				})
				.orderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
				.take(Math.min(Math.max(Number(limit) || 120, 1), 200))
				.getMany();

			const chatIds = rows
				.map((row) => String(row.providerChatId || '').trim())
				.filter(Boolean);
			if (!chatIds.length) {
				this.lastSubscribeAt.set(accountId, Date.now());
				return { ok: true, subscribed: 0 };
			}

			const subscribed = Number((await provider.subscribePresence(chatIds)) || 0);
			this.lastSubscribeAt.set(accountId, Date.now());
			this.logger.debug(
				`Subscribed presence for ${subscribed || chatIds.length} chats on account ${accountId}`,
			);
			return { ok: true, subscribed: subscribed || chatIds.length };
		} catch (error) {
			this.logger.debug(
				`Presence subscribe failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return { ok: false, subscribed: 0 };
		} finally {
			this.subscribeInFlight.delete(accountId);
		}
	}
}
