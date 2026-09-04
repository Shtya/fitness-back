import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import {
	WhatsAppConversation,
	WhatsAppConversationType,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { resolveWhatsAppContactLabel } from '../utils/whatsapp-contact-name';

export type ContactPresenceStatus = 'online' | 'offline' | 'typing' | 'recording';

export type ContactPresenceItem = {
	accountId: string;
	conversationId: string;
	contactId: string | null;
	chatId: string;
	name: string;
	phoneNumber: string | null;
	avatarUrl: string | null;
	/** WhatsApp-derived presence only (Baileys/WPP). Never CRM activity. */
	status: ContactPresenceStatus;
	online: boolean;
	typing: boolean;
	recording: boolean;
	state: string;
	lastSeen: number;
	updatedAt: number;
};

/** Expand stored chat ids so Baileys/WPP subscribe covers @c.us / @s.whatsapp.net aliases. */
export function expandPresenceSubscribeIds(
	chatId: string,
	phoneHint?: string | null,
): string[] {
	const ids = new Set<string>();
	const add = (value: string | null | undefined) => {
		const id = String(value || '').trim();
		if (id) ids.add(id);
	};
	add(chatId);
	if (chatId.endsWith('@c.us')) {
		add(`${chatId.slice(0, -'@c.us'.length)}@s.whatsapp.net`);
	}
	if (chatId.endsWith('@s.whatsapp.net')) {
		add(`${chatId.slice(0, -'@s.whatsapp.net'.length)}@c.us`);
	}
	const digits = String(phoneHint || chatId)
		.replace(/@.*$/, '')
		.replace(/\D/g, '');
	if (digits.length >= 8) {
		add(`${digits}@c.us`);
		add(`${digits}@s.whatsapp.net`);
	}
	return [...ids];
}

/**
 * Tracks WhatsApp *contact* presence from linked-device sessions
 * (Baileys `presence.update` / WPP `onPresenceChanged`).
 * Not CRM staff socket presence.
 *
 * Limits (do not invent status):
 * - WhatsApp only streams presence after `presenceSubscribe(jid)`.
 * - Privacy settings may hide online/last-seen for many contacts.
 * - This is never based on CRM open, DB rows, or last message alone.
 */
@Injectable()
export class WhatsAppContactPresenceService
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(WhatsAppContactPresenceService.name);
	/** `${accountId}:${conversationId}` → latest WhatsApp presence */
	private readonly byConversation = new Map<string, ContactPresenceItem>();
	private readonly lastSubscribeAt = new Map<string, number>();
	private readonly lastRosterAt = new Map<string, number>();
	private readonly subscribeInFlight = new Set<string>();
	private pruneTimer: ReturnType<typeof setInterval> | null = null;
	/** Debug counters (temporary — prove WA → Redis → Socket path). */
	private presenceApplyCount = 0;
	private readonly presenceEventsByAccount = new Map<string, number>();

	/**
	 * WhatsApp does NOT re-send `available` while someone stays online.
	 * Only mark offline on explicit `unavailable` (or session clear).
	 * Typing/recording may stop without an event — clear those quickly.
	 */
	private readonly typingTtlMs = 25_000;
	/** Soft safety if the linked session never gets `unavailable` (hours). */
	private readonly onlineStaleMs = 6 * 60 * 60_000;
	/** Keep offline rows briefly so pinned contacts can still render as offline. */
	private readonly offlineKeepMs = 30 * 60_000;
	private readonly pruneEveryMs = 15_000;
	/** Redis TTL for online rows (must outlive typical chat sessions). */
	private readonly onlineRedisTtlSec = 6 * 60 * 60;

	constructor(
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly gateway: WhatsAppGateway,
		private readonly redis: RedisService,
	) {}

	onModuleInit() {
		this.pruneTimer = setInterval(() => {
			this.pruneAllAccounts();
		}, this.pruneEveryMs);
		if (typeof this.pruneTimer.unref === 'function') {
			this.pruneTimer.unref();
		}
	}

	onModuleDestroy() {
		if (this.pruneTimer) {
			clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
	}

	private key(accountId: string, conversationId: string) {
		return `${accountId}:${conversationId}`;
	}

	private redisKey(accountId: string, conversationId: string) {
		return `wa:presence:${accountId}:${conversationId}`;
	}

	private redisIndexKey(accountId: string) {
		return `wa:presence:index:${accountId}`;
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

	private resolveStatus(state: string, online: boolean): ContactPresenceStatus {
		if (state === 'recording') return 'recording';
		if (state === 'composing') return 'typing';
		if (online) return 'online';
		return 'offline';
	}

	private async persist(entry: ContactPresenceItem) {
		const ttlSec =
			entry.online || entry.typing || entry.recording
				? this.onlineRedisTtlSec
				: Math.ceil(this.offlineKeepMs / 1000);
		try {
			await this.redis.set(
				this.redisKey(entry.accountId, entry.conversationId),
				entry,
				ttlSec,
			);
			const client = (this.redis as any).client;
			if (client?.sadd) {
				await client.sadd(
					this.redisIndexKey(entry.accountId),
					entry.conversationId,
				);
				await client.expire(
					this.redisIndexKey(entry.accountId),
					Math.max(ttlSec, this.onlineRedisTtlSec),
				);
			}
			this.logger.debug(
				`[WHATSAPP PRESENCE] Redis SET key=${this.redisKey(
					entry.accountId,
					entry.conversationId,
				)} online=${entry.online} status=${entry.status} ttlSec=${ttlSec}`,
			);
		} catch (error) {
			this.logger.warn(
				`[WHATSAPP PRESENCE] Redis SET failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private async removePersisted(accountId: string, conversationId: string) {
		try {
			await this.redis.del(this.redisKey(accountId, conversationId));
			const client = (this.redis as any).client;
			if (client?.srem) {
				await client.srem(this.redisIndexKey(accountId), conversationId);
			}
		} catch {
			/* Redis optional */
		}
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
		if (!this.isDirectChat(conversation)) {
			this.logger.log(
				`[WHATSAPP PRESENCE] DROP non-direct conversationId=${conversation?.id} chatId=${conversation?.providerChatId}`,
			);
			return;
		}
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
		const updatedAt = Number(payload?.t) || Date.now();
		const lastSeen = Number(payload?.lastSeen || 0) || 0;
		const prev = this.byConversation.get(mapKey);

		const next: ContactPresenceItem = {
			accountId,
			conversationId,
			contactId: conversation.contactId || conversation.contact?.id || null,
			chatId: String(conversation.providerChatId || ''),
			name: this.displayName(conversation, prev?.name),
			phoneNumber:
				conversation.contact?.phoneNumber || prev?.phoneNumber || null,
			avatarUrl: conversation.contact?.avatarUrl || prev?.avatarUrl || null,
			status: this.resolveStatus(state, online),
			online,
			typing,
			recording,
			state,
			lastSeen: lastSeen || prev?.lastSeen || 0,
			updatedAt,
		};

		this.byConversation.set(mapKey, next);
		void this.persist(next);

		this.presenceApplyCount += 1;
		this.presenceEventsByAccount.set(
			accountId,
			(this.presenceEventsByAccount.get(accountId) || 0) + 1,
		);
		this.logger.log(
			`[WHATSAPP PRESENCE]\n` +
				`  Session: ${accountId}\n` +
				`  Conversation: ${conversationId}\n` +
				`  JID: ${next.chatId}\n` +
				`  Status: ${next.state}\n` +
				`  Online: ${next.online}\n` +
				`  LastSeen: ${next.lastSeen || 'n/a'}\n` +
				`  Timestamp: ${new Date(updatedAt).toISOString()}\n` +
				`  AppliedTotal: ${this.presenceApplyCount} (account=${this.presenceEventsByAccount.get(accountId)})`,
		);

		const changed =
			!prev ||
			prev.online !== next.online ||
			prev.status !== next.status ||
			prev.name !== next.name ||
			prev.avatarUrl !== next.avatarUrl ||
			prev.typing !== next.typing ||
			prev.recording !== next.recording ||
			prev.lastSeen !== next.lastSeen;
		if (changed) this.broadcast(accountId);
	}

	/**
	 * Cache conversation identity for pin / lastSeen UI.
	 * Never marks contacts online — only WhatsApp presence events may do that.
	 */
	seedConversationRoster(
		accountId: string,
		conversations: WhatsAppConversation[],
		options?: { broadcast?: boolean },
	) {
		let changed = false;
		const now = Date.now();
		for (const conversation of conversations || []) {
			if (!this.isDirectChat(conversation)) continue;
			const conversationId = String(conversation.id || '');
			if (!conversationId) continue;
			const mapKey = this.key(accountId, conversationId);
			const prev = this.byConversation.get(mapKey);
			const name = this.displayName(conversation, prev?.name);
			const avatarUrl =
				conversation.contact?.avatarUrl || prev?.avatarUrl || null;
			const phoneNumber =
				conversation.contact?.phoneNumber || prev?.phoneNumber || null;
			const contactId =
				conversation.contactId || conversation.contact?.id || prev?.contactId || null;
			const chatId = String(conversation.providerChatId || prev?.chatId || '');

			if (prev) {
				const identityChanged =
					prev.name !== name ||
					prev.avatarUrl !== avatarUrl ||
					prev.phoneNumber !== phoneNumber ||
					prev.chatId !== chatId;
				if (identityChanged) {
					const next = {
						...prev,
						name,
						avatarUrl,
						phoneNumber,
						contactId,
						chatId,
					};
					this.byConversation.set(mapKey, next);
					void this.persist(next);
					changed = true;
				}
				continue;
			}

			const next: ContactPresenceItem = {
				accountId,
				conversationId,
				contactId,
				chatId,
				name,
				phoneNumber,
				avatarUrl,
				status: 'offline',
				online: false,
				typing: false,
				recording: false,
				state: 'unavailable',
				lastSeen: 0,
				updatedAt: now,
			};
			this.byConversation.set(mapKey, next);
			void this.persist(next);
			changed = true;
		}
		if (changed && options?.broadcast) this.broadcast(accountId);
	}

	clearAccount(accountId: string) {
		let changed = false;
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId === accountId) {
				this.byConversation.delete(mapKey);
				void this.removePersisted(accountId, entry.conversationId);
				changed = true;
			}
		}
		this.lastSubscribeAt.delete(accountId);
		this.lastRosterAt.delete(accountId);
		if (changed) this.broadcast(accountId);
	}

	/** @returns true if any entry changed (typing clear / rare stale online / drop). */
	private pruneMemory(accountId: string): boolean {
		const now = Date.now();
		let changed = false;
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId !== accountId) continue;
			const age = now - entry.updatedAt;

			// Typing indicators are short-lived; online itself is event-driven.
			if ((entry.typing || entry.recording) && age > this.typingTtlMs) {
				entry.typing = false;
				entry.recording = false;
				entry.status = entry.online ? 'online' : 'offline';
				entry.state = entry.online ? 'available' : 'unavailable';
				entry.updatedAt = now;
				this.byConversation.set(mapKey, entry);
				void this.persist(entry);
				changed = true;
			}

			// Soft safety only — WhatsApp normally sends unavailable.
			if (entry.online && age > this.onlineStaleMs) {
				this.logger.log(
					`[WHATSAPP PRESENCE] Soft-stale online→offline session=${accountId} jid=${entry.chatId} ageMs=${age}`,
				);
				entry.online = false;
				entry.status = 'offline';
				entry.typing = false;
				entry.recording = false;
				entry.state = 'unavailable';
				entry.updatedAt = now;
				this.byConversation.set(mapKey, entry);
				void this.persist(entry);
				changed = true;
				continue;
			}

			if (!entry.online && !entry.typing && !entry.recording && age > this.offlineKeepMs) {
				this.byConversation.delete(mapKey);
				void this.removePersisted(accountId, entry.conversationId);
				changed = true;
			}
		}
		return changed;
	}

	private pruneAllAccounts() {
		const accountIds = new Set<string>();
		for (const entry of this.byConversation.values()) {
			accountIds.add(entry.accountId);
		}
		for (const accountId of accountIds) {
			if (this.pruneMemory(accountId)) {
				this.broadcast(accountId);
			}
		}
	}

	private async hydrateFromRedis(accountId: string) {
		if (!(await this.redis.isAvailable())) return;
		try {
			const client = (this.redis as any).client;
			let conversationIds: string[] = [];
			if (client?.smembers) {
				conversationIds = await client.smembers(this.redisIndexKey(accountId));
			}
			if (!conversationIds.length) {
				const keys =
					typeof (this.redis as any).scanKeys === 'function'
						? await (this.redis as any).scanKeys(`wa:presence:${accountId}:*`)
						: await this.redis.keys(`wa:presence:${accountId}:*`);
				for (const redisKey of keys || []) {
					const entry = await this.redis.get<ContactPresenceItem>(redisKey);
					if (!entry?.conversationId || entry.accountId !== accountId) continue;
					conversationIds.push(entry.conversationId);
					this.mergeHydrated(entry);
				}
				return;
			}
			for (const conversationId of conversationIds) {
				const entry = await this.redis.get<ContactPresenceItem>(
					this.redisKey(accountId, conversationId),
				);
				if (!entry?.conversationId || entry.accountId !== accountId) continue;
				this.mergeHydrated(entry);
			}
		} catch (error) {
			this.logger.debug(
				`Presence Redis hydrate failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private mergeHydrated(entry: ContactPresenceItem) {
		const mapKey = this.key(entry.accountId, entry.conversationId);
		const existing = this.byConversation.get(mapKey);
		if (!existing || existing.updatedAt < Number(entry.updatedAt || 0)) {
			this.byConversation.set(mapKey, {
				...entry,
				online: Boolean(entry.online),
				typing: Boolean(entry.typing),
				recording: Boolean(entry.recording),
				status: entry.status || (entry.online ? 'online' : 'offline'),
			});
		}
	}

	/**
	 * Snapshot for Online Contacts bar / API.
	 * By default returns only WhatsApp-reported online/typing/recording.
	 * Pass includeOffline for pin lookups.
	 */
	async listOnline(
		accountId: string,
		options?: { includeOffline?: boolean },
	) {
		await this.hydrateFromRedis(accountId);
		this.pruneMemory(accountId);
		const now = Date.now();
		const includeOffline = Boolean(options?.includeOffline);
		const items: ContactPresenceItem[] = [];
		for (const entry of this.byConversation.values()) {
			if (entry.accountId !== accountId) continue;
			const age = now - entry.updatedAt;
			const isLive = entry.online || entry.typing || entry.recording;
			if (!isLive && (!includeOffline || age > this.offlineKeepMs)) continue;
			if (!includeOffline && !isLive) continue;
			items.push(entry);
		}
		items.sort((a, b) => {
			const aLive = a.online || a.typing || a.recording ? 1 : 0;
			const bLive = b.online || b.typing || b.recording ? 1 : 0;
			if (aLive !== bLive) return bLive - aLive;
			return (b.updatedAt || 0) - (a.updatedAt || 0);
		});
		this.logger.log(
			`[WHATSAPP PRESENCE] listOnline session=${accountId} live=${items.filter((i) => i.online || i.typing || i.recording).length} totalReturned=${items.length} appliedEvents=${this.presenceEventsByAccount.get(accountId) || 0}`,
		);
		return {
			accountId,
			items,
			at: new Date().toISOString(),
		};
	}

	private broadcast(accountId: string) {
		void this.listOnline(accountId, { includeOffline: true }).then((snapshot) => {
			const live = (snapshot.items || []).filter(
				(i) => i.online || i.typing || i.recording,
			).length;
			this.logger.log(
				`[WHATSAPP PRESENCE] Socket.IO emit online_contacts session=${accountId} live=${live} items=${snapshot.items?.length || 0}`,
			);
			this.gateway.emitAccountEvent(accountId, 'online_contacts', snapshot);
		});
	}

	/**
	 * Subscribe to WhatsApp presence for recent 1:1 chats.
	 * Required: Baileys only streams presence after `presenceSubscribe(jid)`.
	 */
	async subscribeRecentDirectChats(accountId: string, limit = 120, force = false) {
		const last = this.lastSubscribeAt.get(accountId) || 0;
		if (!force && Date.now() - last < 45_000) {
			return { ok: true, subscribed: 0, skipped: true };
		}
		if (this.subscribeInFlight.has(accountId)) {
			return { ok: true, subscribed: 0, skipped: true };
		}
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected' || !provider.subscribePresence) {
			this.logger.log(
				`[WHATSAPP PRESENCE] Subscribe blocked session=${accountId} provider=${Boolean(
					provider,
				)} state=${provider?.getState?.() || 'n/a'} hasSubscribe=${Boolean(
					provider?.subscribePresence,
				)}`,
			);
			return { ok: false, subscribed: 0 };
		}

		this.subscribeInFlight.add(accountId);
		try {
			const rows = await this.conversationRepo
				.createQueryBuilder('conversation')
				.leftJoinAndSelect('conversation.contact', 'contact')
				.where('conversation.accountId = :accountId', { accountId })
				.andWhere('conversation.type = :type', {
					type: WhatsAppConversationType.DIRECT,
				})
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

			this.seedConversationRoster(accountId, rows, { broadcast: false });

			const chatIds = [
				...new Set(
					rows.flatMap((row) =>
						expandPresenceSubscribeIds(
							String(row.providerChatId || '').trim(),
							row.contact?.phoneNumber,
						),
					),
				),
			].filter(Boolean);
			if (!chatIds.length) {
				this.lastSubscribeAt.set(accountId, Date.now());
				this.logger.log(
					`[WHATSAPP PRESENCE] Subscribe skipped — no direct chat JIDs session=${accountId}`,
				);
				return { ok: true, subscribed: 0 };
			}

			const subscribed = Number((await provider.subscribePresence(chatIds)) || 0);
			this.lastSubscribeAt.set(accountId, Date.now());
			this.logger.log(
				`[WHATSAPP PRESENCE] Subscribed session=${accountId} jids=${chatIds.length} ok=${subscribed || chatIds.length} sample=${chatIds.slice(0, 5).join(',')}`,
			);
			return { ok: true, subscribed: subscribed || chatIds.length };
		} catch (error) {
			this.logger.warn(
				`[WHATSAPP PRESENCE] Subscribe failed session=${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return { ok: false, subscribed: 0 };
		} finally {
			this.subscribeInFlight.delete(accountId);
		}
	}

	/**
	 * Light roster warm for pin identity only — does not invent online status.
	 */
	async ensureRoster(accountId: string, limit = 40) {
		const last = this.lastRosterAt.get(accountId) || 0;
		let hasRows = false;
		for (const entry of this.byConversation.values()) {
			if (entry.accountId === accountId) {
				hasRows = true;
				break;
			}
		}
		if (hasRows && Date.now() - last < 60_000) {
			return 0;
		}
		const rows = await this.conversationRepo
			.createQueryBuilder('conversation')
			.leftJoinAndSelect('conversation.contact', 'contact')
			.where('conversation.accountId = :accountId', { accountId })
			.andWhere('conversation.type = :type', {
				type: WhatsAppConversationType.DIRECT,
			})
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
			.take(Math.min(Math.max(Number(limit) || 40, 1), 80))
			.getMany();
		this.seedConversationRoster(accountId, rows, { broadcast: false });
		this.lastRosterAt.set(accountId, Date.now());
		return rows.length;
	}

	/** Test helper: inspect in-memory presence for an account. */
	getMemorySnapshot(accountId: string): ContactPresenceItem[] {
		return [...this.byConversation.values()].filter(
			(entry) => entry.accountId === accountId,
		);
	}
}
