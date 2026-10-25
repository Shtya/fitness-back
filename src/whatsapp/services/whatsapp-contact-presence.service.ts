import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RedisService } from '../../redis/redis.service';
import {
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppConversationType,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { resolveWhatsAppContactLabel } from '../utils/whatsapp-contact-name';

export type ContactPresenceStatus =
	| 'online'
	| 'offline'
	| 'typing'
	| 'recording'
	| 'unknown';

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

/** Hard cap after alias expansion — Baileys rate-limits subscribe floods. */
const PRESENCE_SUBSCRIBE_JID_CAP = 350;

/**
 * Tracks WhatsApp *contact* presence from linked-device sessions
 * (Baileys `presence.update` / WPP `onPresenceChanged`).
 * Not CRM staff socket presence.
 *
 * Limits (do not invent status):
 * - WhatsApp only streams presence after `presenceSubscribe(jid)`.
 * - Privacy settings may hide online/last-seen for many contacts.
 * - This is never based on CRM open, DB rows, or last message alone.
 * - Subscribe covers recent 1:1 chats **and** address-book contacts (capped),
 *   not only people you already messaged.
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
	private readonly hydratedAccounts = new Set<string>();
	private readonly hydrating = new Map<string, Promise<void>>();
	private readonly pendingBroadcast = new Set<string>();
	private pruneTimer: ReturnType<typeof setInterval> | null = null;
	/** Per-account counters behind GET /whatsapp/presence/diagnostics. */
	private readonly stats = new Map<
		string,
		{
			byState: Record<string, number>;
			lastEventAt: number;
			lastLiveAt: number;
			drops: Record<string, number>;
			subscribe: { at: number; requested: number; ok: number; result: string } | null;
			/** Contacts with an unexpired privacy token at the last subscribe (null = unknown). */
			tokenHolders: number | null;
		}
	>();
	/**
	 * Shared mode: another server holds this account's WhatsApp session (shared Redis lock), so
	 * presence events land there and are only visible here through Redis. accountId → last request.
	 */
	private readonly sharedAccounts = new Map<string, number>();
	private readonly lastSharedRefreshAt = new Map<string, number>();
	private readonly sharedPrimed = new Set<string>();
	/** accountId → whether a session owner held the lock at the last shared read. */
	private readonly sharedOwnerAlive = new Map<string, boolean>();
	private sharedTimer: ReturnType<typeof setInterval> | null = null;
	private readonly sharedPollMs = 4_000;
	private readonly sharedIdleMs = 5 * 60_000;
	/**
	 * Every JID form WhatsApp used for a person (phone @c.us/@s.whatsapp.net, @lid, …) → the
	 * conversation their presence was applied to. WhatsApp may report "online" under one form and
	 * "offline" under another; without this the offline event missed the row and it stayed online.
	 */
	private readonly aliasToConversation = new Map<string, string>();
	/** `${accountId}:${conversationId}` → when we re-subscribed to confirm a live status. */
	private readonly verifyPendingSince = new Map<string, number>();
	private verifyTimer: ReturnType<typeof setInterval> | null = null;
	private readonly verifyEveryMs = 90_000;
	/** WhatsApp answers a subscribe within seconds; no answer by then = we can't confirm. */
	private readonly verifyAnswerMs = 45_000;
	private readonly fullResubscribeMs = 10 * 60_000;
	private readonly lastFullSubscribeAt = new Map<string, number>();
	private readonly pendingTokenJids = new Map<string, Set<string>>();
	private readonly tokenTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private unsubscribeProviderEvents: (() => void) | null = null;
	/** Notified when WhatsApp reports a contact going from not-live to online/typing/recording. */
	private readonly cameOnlineListeners = new Set<(entry: ContactPresenceItem) => void>();
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
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
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
		this.sharedTimer = setInterval(() => {
			void this.pollSharedAccounts();
		}, this.sharedPollMs);
		this.sharedTimer.unref?.();
		this.verifyTimer = setInterval(() => {
			void this.verifyLiveContacts();
		}, this.verifyEveryMs);
		this.verifyTimer.unref?.();
		this.unsubscribeProviderEvents =
			this.providers.onProviderEvent?.((accountId, event) => {
				if (event?.type === 'presence_token') this.queueTokenSubscribe(accountId, event.jids || []);
			}) ?? null;
	}

	onModuleDestroy() {
		if (this.pruneTimer) {
			clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
		if (this.sharedTimer) {
			clearInterval(this.sharedTimer);
			this.sharedTimer = null;
		}
		if (this.verifyTimer) {
			clearInterval(this.verifyTimer);
			this.verifyTimer = null;
		}
		for (const timer of this.tokenTimers.values()) clearTimeout(timer);
		this.tokenTimers.clear();
		this.unsubscribeProviderEvents?.();
	}

	private aliasKey(accountId: string, jid: string) {
		return `${accountId}|${String(jid || '').trim().toLowerCase()}`;
	}

	/** Remember every id form WhatsApp used for this conversation's contact. */
	rememberAliases(accountId: string, conversationId: string, jids: Array<string | null | undefined>) {
		for (const jid of jids) {
			const id = String(jid || '').trim();
			if (!id) continue;
			this.aliasToConversation.set(this.aliasKey(accountId, id), conversationId);
			const bare = id.replace(/:\d+@/, '@');
			if (bare !== id) this.aliasToConversation.set(this.aliasKey(accountId, bare), conversationId);
			if (id.endsWith('@s.whatsapp.net')) {
				this.aliasToConversation.set(this.aliasKey(accountId, id.replace(/@s\.whatsapp\.net$/, '@c.us')), conversationId);
			}
		}
	}

	/**
	 * Conversation a presence packet belongs to, from ids seen before or the phone number of a
	 * tracked contact — so the matching "offline" always reaches the row that went "online".
	 */
	lookupAlias(accountId: string, jids: Array<string | null | undefined>, phoneDigits?: string | null) {
		for (const jid of jids) {
			const id = String(jid || '').trim();
			if (!id) continue;
			const hit =
				this.aliasToConversation.get(this.aliasKey(accountId, id)) ||
				this.aliasToConversation.get(this.aliasKey(accountId, id.replace(/:\d+@/, '@')));
			if (hit) return hit;
		}
		const digits = String(phoneDigits || '').replace(/\D/g, '');
		if (digits.length >= 8) {
			for (const entry of this.byConversation.values()) {
				if (entry.accountId !== accountId) continue;
				if (String(entry.phoneNumber || '').replace(/\D/g, '') === digits) return entry.conversationId;
			}
		}
		return null;
	}

	/** New privacy tokens: subscribe to those people now (batched), not on the next page load. */
	private queueTokenSubscribe(accountId: string, jids: string[]) {
		if (!jids.length) return;
		if (!this.pendingTokenJids.has(accountId)) this.pendingTokenJids.set(accountId, new Set());
		const set = this.pendingTokenJids.get(accountId)!;
		for (const jid of jids) if (this.isPresenceEligibleJid(jid)) set.add(jid);
		if (this.tokenTimers.has(accountId)) return;
		const timer = setTimeout(() => {
			this.tokenTimers.delete(accountId);
			const batch = [...(this.pendingTokenJids.get(accountId) || [])];
			this.pendingTokenJids.delete(accountId);
			const provider = this.providers.getProvider(accountId);
			if (!batch.length || provider?.getState() !== 'connected' || !provider.subscribePresence) return;
			void Promise.resolve(provider.subscribePresence(batch))
				.then(() =>
					this.logger.log(
						`[WHATSAPP PRESENCE] subscribed after new privacy token session=${accountId} jids=${batch.length}`,
					),
				)
				.catch(() => undefined);
		}, 1_500);
		timer.unref?.();
		this.tokenTimers.set(accountId, timer);
	}

	/**
	 * Confirm live statuses instead of trusting them until an event happens to arrive.
	 * Re-subscribing makes WhatsApp answer with the current presence (available / unavailable).
	 * A live row with no answer becomes "unknown" — never "offline" and never kept "online".
	 */
	private async verifyLiveContacts() {
		const now = Date.now();
		const byAccount = new Map<string, ContactPresenceItem[]>();
		for (const entry of this.byConversation.values()) {
			if (!(entry.online || entry.typing || entry.recording)) continue;
			if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
			byAccount.get(entry.accountId)!.push(entry);
		}
		const accounts = new Set<string>([...byAccount.keys(), ...this.lastFullSubscribeAt.keys()]);
		for (const accountId of accounts) {
			if (this.sharedAccounts.has(accountId)) continue;
			const provider = this.providers.getProvider(accountId);
			if (!provider || provider.getState() !== 'connected' || !provider.subscribePresence) continue;
			if (provider.isOnlinePresence?.() === false) continue; // answers would all be "unavailable"
			let changed = false;
			const toVerify: string[] = [];
			for (const entry of byAccount.get(accountId) || []) {
				const key = this.key(accountId, entry.conversationId);
				const askedAt = this.verifyPendingSince.get(key);
				if (askedAt && now - askedAt >= this.verifyAnswerMs) {
					this.verifyPendingSince.delete(key);
					this.logger.log(
						`[WHATSAPP PRESENCE] live status not confirmed → unknown session=${accountId} conversation=${entry.conversationId}`,
					);
					const next: ContactPresenceItem = {
						...entry,
						online: false,
						typing: false,
						recording: false,
						status: 'unknown',
						state: 'unknown',
						updatedAt: now,
					};
					this.byConversation.set(key, next);
					void this.persist(next);
					changed = true;
					continue;
				}
				if (!askedAt && now - entry.updatedAt >= this.verifyEveryMs - 5_000) {
					this.verifyPendingSince.set(key, now);
					toVerify.push(...expandPresenceSubscribeIds(entry.chatId, entry.phoneNumber));
				}
			}
			if (toVerify.length) {
				await Promise.resolve(provider.subscribePresence([...new Set(toVerify)])).catch(() => undefined);
			}
			if (changed) this.broadcast(accountId);
			const lastFull = this.lastFullSubscribeAt.get(accountId) || 0;
			if (now - lastFull >= this.fullResubscribeMs) {
				this.lastFullSubscribeAt.set(accountId, now);
				void this.subscribeRecentDirectChats(accountId, 200, true).catch(() => undefined);
			}
		}
	}

	/** True when this process holds the account's live WhatsApp socket. */
	private isSessionOwner(accountId: string) {
		const provider = this.providers.getProvider(accountId);
		return Boolean(provider && provider.getState() === 'connected');
	}

	private emitCameOnline(entry: ContactPresenceItem) {
		for (const listener of this.cameOnlineListeners) {
			try {
				listener({ ...entry });
			} catch (error) {
				this.logger.warn(
					`[WHATSAPP PRESENCE] came-online listener failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}

	/**
	 * Re-read the account's presence from Redis (written by the server that owns the session).
	 * Never writes. If no server holds the session lock any more, "online" rows are stale — they
	 * are shown as unknown instead of live.
	 */
	private async refreshShared(accountId: string, minIntervalMs = 2_500): Promise<boolean> {
		const last = this.lastSharedRefreshAt.get(accountId) || 0;
		if (Date.now() - last < minIntervalMs) return false;
		this.lastSharedRefreshAt.set(accountId, Date.now());
		let entries: ContactPresenceItem[] = [];
		let ownerAlive = false;
		try {
			const ids = await this.redis.sMembers(this.redisIndexKey(accountId));
			const rows = ids.length
				? await this.redis.mGet<ContactPresenceItem>(ids.map((id) => this.redisKey(accountId, id)))
				: [];
			entries = rows.filter(
				(entry): entry is ContactPresenceItem =>
					Boolean(entry?.conversationId) && entry?.accountId === accountId,
			);
			ownerAlive = Boolean(await this.redis.exists(`whatsapp:conn-lock:${accountId}`));
		} catch (error) {
			this.logger.debug(
				`[WHATSAPP PRESENCE] shared read failed session=${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return false;
		}
		const ownerWasAlive = this.sharedOwnerAlive.get(accountId);
		this.sharedOwnerAlive.set(accountId, ownerAlive);
		if (ownerWasAlive !== ownerAlive) {
			this.logger.log(
				`[WHATSAPP PRESENCE] shared mode session=${accountId} owner=${ownerAlive ? 'another server' : 'none (no live session anywhere)'}`,
			);
		}

		const primed = this.sharedPrimed.has(accountId);
		const fresh = new Map(entries.map((entry) => [String(entry.conversationId), entry]));
		let changed = false;
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId === accountId && !fresh.has(String(entry.conversationId))) {
				this.byConversation.delete(mapKey);
				changed = true;
			}
		}
		for (const raw of fresh.values()) {
			const liveRaw = Boolean(raw.online || raw.typing || raw.recording);
			const next: ContactPresenceItem = {
				...raw,
				online: ownerAlive && Boolean(raw.online),
				typing: ownerAlive && Boolean(raw.typing),
				recording: ownerAlive && Boolean(raw.recording),
				status: liveRaw && !ownerAlive ? 'unknown' : raw.status || (raw.online ? 'online' : 'unknown'),
				state: liveRaw && !ownerAlive ? 'unknown' : raw.state,
			};
			const mapKey = this.key(accountId, String(next.conversationId));
			const prev = this.byConversation.get(mapKey);
			if (
				prev &&
				prev.updatedAt === next.updatedAt &&
				prev.status === next.status &&
				prev.online === next.online &&
				prev.typing === next.typing &&
				prev.recording === next.recording &&
				prev.lastSeen === next.lastSeen &&
				prev.name === next.name
			) {
				continue;
			}
			this.byConversation.set(mapKey, next);
			changed = true;
			const wasLive = Boolean(prev && (prev.online || prev.typing || prev.recording));
			const isLive = next.online || next.typing || next.recording;
			// The first read is the baseline — alerting for everyone already online would be noise.
			if (primed && !wasLive && isLive) this.emitCameOnline(next);
		}
		this.sharedPrimed.add(accountId);
		this.hydratedAccounts.add(accountId);
		return changed;
	}

	/** While someone is looking, keep shared accounts fresh and push changes to their sockets. */
	private async pollSharedAccounts() {
		const now = Date.now();
		for (const [accountId, seenAt] of this.sharedAccounts) {
			if (now - seenAt > this.sharedIdleMs || this.isSessionOwner(accountId)) {
				this.sharedAccounts.delete(accountId);
				this.sharedPrimed.delete(accountId);
				continue;
			}
			const viewers = this.gateway.accountWatcherCount?.(accountId) ?? 0;
			if (!viewers && now - seenAt > 60_000) continue;
			if (await this.refreshShared(accountId, this.sharedPollMs - 500)) this.broadcast(accountId);
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

	private resolveStatus(
		state: string,
		online: boolean,
		options?: { confirmed?: boolean },
	): ContactPresenceStatus {
		if (state === 'recording') return 'recording';
		if (state === 'composing') return 'typing';
		if (online) return 'online';
		if (state === 'unavailable' && options?.confirmed !== false) return 'offline';
		return 'unknown';
	}

	private async persist(entry: ContactPresenceItem) {
		const ttlSec =
			entry.online || entry.typing || entry.recording
				? this.onlineRedisTtlSec
				: Math.ceil(this.offlineKeepMs / 1000);
		try {
			await this.redis.setWithIndex(
				this.redisKey(entry.accountId, entry.conversationId),
				entry,
				ttlSec,
				this.redisIndexKey(entry.accountId),
				entry.conversationId,
				Math.max(ttlSec, this.onlineRedisTtlSec),
			);
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
			await this.redis.delWithIndex(
				[this.redisKey(accountId, conversationId)],
				this.redisIndexKey(accountId),
				[conversationId],
			);
		} catch {
			/* Redis optional */
		}
	}

	private async removePersistedAccount(accountId: string) {
		try {
			const indexKey = this.redisIndexKey(accountId);
			const ids = await this.redis.sMembers(indexKey);
			const keys = [...ids.map((id) => this.redisKey(accountId, id)), indexKey];
			await this.redis.delWithIndex(keys, indexKey, []);
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
			lastSeenRestricted?: boolean;
			confirmed?: boolean;
			t?: number;
		},
	) {
		if (!this.isDirectChat(conversation)) {
			this.logger.debug(
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
		const confirmed =
			payload?.confirmed !== undefined
				? Boolean(payload.confirmed)
				: state === 'available' || state === 'unavailable';
		const prev = this.byConversation.get(mapKey);
		const stat = this.statsFor(accountId);
		stat.byState[state] = (stat.byState[state] || 0) + 1;
		stat.lastEventAt = Date.now();
		if (online || typing || recording) stat.lastLiveAt = stat.lastEventAt;
		// WhatsApp often sends unavailable without lastSeen. If we just saw them
		// online, stamp the last observation time so the CRM header can show
		// "last online …" instead of a bare Offline label.
		let resolvedLastSeen = lastSeen || prev?.lastSeen || 0;
		if (
			!resolvedLastSeen &&
			prev?.online &&
			!online &&
			!typing &&
			!recording
		) {
			resolvedLastSeen = Number(prev.updatedAt || updatedAt) || updatedAt;
		}

		const next: ContactPresenceItem = {
			accountId,
			conversationId,
			contactId: conversation.contactId || conversation.contact?.id || null,
			chatId: String(conversation.providerChatId || ''),
			name: this.displayName(conversation, prev?.name),
			phoneNumber:
				conversation.contact?.phoneNumber || prev?.phoneNumber || null,
			avatarUrl: conversation.contact?.avatarUrl || prev?.avatarUrl || null,
			status: this.resolveStatus(state, online, { confirmed }),
			online,
			typing,
			recording,
			state,
			lastSeen: resolvedLastSeen,
			updatedAt,
		};

		this.byConversation.set(mapKey, next);
		void this.persist(next);
		// WhatsApp answered — any pending "is this still live?" check is resolved.
		this.verifyPendingSince.delete(mapKey);
		this.rememberAliases(accountId, conversationId, [next.chatId]);

		// One person can sit on two rows (phone chat + LID chat). A confirmed "offline" for them
		// must not leave the twin row showing online.
		if (state === 'unavailable' && !online && !typing && !recording) {
			const digits = String(next.phoneNumber || '').replace(/\D/g, '');
			for (const [otherKey, other] of this.byConversation) {
				if (otherKey === mapKey || other.accountId !== accountId) continue;
				if (!(other.online || other.typing || other.recording)) continue;
				const samePerson =
					(next.contactId && other.contactId === next.contactId) ||
					(digits.length >= 8 && String(other.phoneNumber || '').replace(/\D/g, '') === digits);
				if (!samePerson) continue;
				const twin: ContactPresenceItem = {
					...other,
					online: false,
					typing: false,
					recording: false,
					status: 'offline',
					state: 'unavailable',
					lastSeen: next.lastSeen || other.lastSeen,
					updatedAt,
				};
				this.byConversation.set(otherKey, twin);
				void this.persist(twin);
			}
		}

		this.presenceApplyCount += 1;
		this.presenceEventsByAccount.set(
			accountId,
			(this.presenceEventsByAccount.get(accountId) || 0) + 1,
		);
		this.logger.debug(
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

		const wasLive = Boolean(prev && (prev.online || prev.typing || prev.recording));
		const isLive = next.online || next.typing || next.recording;
		if (!wasLive && isLive) this.emitCameOnline(next);

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

	private statsFor(accountId: string) {
		let s = this.stats.get(accountId);
		if (!s) {
			s = { byState: {}, lastEventAt: 0, lastLiveAt: 0, drops: {}, subscribe: null, tokenHolders: null };
			this.stats.set(accountId, s);
		}
		return s;
	}

	/** Presence packets the sync layer could not use (unsupported id, no matching chat, …). */
	noteDrop(accountId: string, reason: string) {
		const s = this.statsFor(accountId);
		s.drops[reason] = (s.drops[reason] || 0) + 1;
	}

	private noteSubscribe(accountId: string, requested: number, ok: number, result: string) {
		this.statsFor(accountId).subscribe = { at: Date.now(), requested, ok, result };
	}

	/** Counters + current snapshot sizes for one account (no contact names or numbers). */
	diagnostics(accountId: string) {
		const s = this.statsFor(accountId);
		let live = 0;
		let offline = 0;
		let unknown = 0;
		for (const entry of this.byConversation.values()) {
			if (entry.accountId !== accountId) continue;
			if (entry.online || entry.typing || entry.recording) live += 1;
			else if (entry.status === 'offline') offline += 1;
			else unknown += 1;
		}
		const iso = (t: number) => (t ? new Date(t).toISOString() : null);
		return {
			eventsByState: { ...s.byState },
			lastEventAt: iso(s.lastEventAt),
			lastLiveAt: iso(s.lastLiveAt),
			droppedEvents: { ...s.drops },
			lastSubscribe: s.subscribe ? { ...s.subscribe, at: iso(s.subscribe.at) } : null,
			contactsWithPrivacyToken: s.tokenHolders,
			pendingVerifications: [...this.verifyPendingSince.keys()].filter((k) => k.startsWith(accountId + ':')).length,
			sessionOwner: this.isSessionOwner(accountId)
				? 'this server'
				: this.sharedOwnerAlive.get(accountId) === true
					? 'another server (read through shared Redis)'
					: this.sharedOwnerAlive.get(accountId) === false
						? 'none — no server holds this WhatsApp session'
						: 'unknown (not read yet)',
			sharedRefreshedAt: iso(this.lastSharedRefreshAt.get(accountId) || 0),
			tracked: { live, offline, unknown },
		};
	}

	/** Subscribe to "contact came online" transitions. Returns an unsubscribe function. */
	onCameOnline(listener: (entry: ContactPresenceItem) => void) {
		this.cameOnlineListeners.add(listener);
		return () => this.cameOnlineListeners.delete(listener);
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
					if (!this.sharedAccounts.has(accountId)) void this.persist(next);
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
				status: 'unknown',
				online: false,
				typing: false,
				recording: false,
				state: 'unknown',
				lastSeen: 0,
				updatedAt: now,
			};
			this.byConversation.set(mapKey, next);
			if (!this.sharedAccounts.has(accountId)) void this.persist(next);
			changed = true;
		}
		if (changed && options?.broadcast) this.broadcast(accountId);
	}

	clearAccount(accountId: string) {
		let changed = false;
		for (const [mapKey, entry] of this.byConversation) {
			if (entry.accountId === accountId) {
				this.byConversation.delete(mapKey);
				changed = true;
			}
		}
		void this.removePersistedAccount(accountId);
		this.lastSubscribeAt.delete(accountId);
		this.lastRosterAt.delete(accountId);
		if (changed) this.broadcast(accountId);
	}

	/** @returns true if any entry changed (typing clear / rare stale online / drop). */
	private pruneMemory(accountId: string): boolean {
		// Shared mode: the owning server prunes and Redis TTLs expire rows; never write from here.
		if (this.sharedAccounts.has(accountId)) return false;
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

			// Soft safety only — no explicit unavailable arrived, so presence is unknown.
			if (entry.online && age > this.onlineStaleMs) {
				this.logger.log(
					`[WHATSAPP PRESENCE] Soft-stale online→unknown session=${accountId} jid=${entry.chatId} ageMs=${age}`,
				);
				if (!entry.lastSeen) {
					entry.lastSeen = Number(entry.updatedAt || now) || now;
				}
				entry.online = false;
				entry.status = 'unknown';
				entry.typing = false;
				entry.recording = false;
				entry.state = 'unknown';
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

	/**
	 * Memory is authoritative while the process lives; Redis only restores
	 * presence after a restart, so each account is hydrated once.
	 */
	private ensureHydrated(accountId: string): Promise<void> {
		if (this.hydratedAccounts.has(accountId)) return Promise.resolve();
		let pending = this.hydrating.get(accountId);
		if (!pending) {
			pending = this.hydrateFromRedis(accountId).finally(() => {
				this.hydrating.delete(accountId);
			});
			this.hydrating.set(accountId, pending);
		}
		return pending;
	}

	private async hydrateFromRedis(accountId: string) {
		if (!(await this.redis.isAvailable())) return;
		try {
			const indexed = await this.redis.sMembers(this.redisIndexKey(accountId));
			const keys = indexed.length
				? indexed.map((id) => this.redisKey(accountId, id))
				: (await this.redis.scanKeys(`wa:presence:${accountId}:*`)).filter(
						(key) => key !== this.redisIndexKey(accountId),
					);
			const entries = await this.redis.mGet<ContactPresenceItem>(keys);
			for (const entry of entries) {
				if (!entry?.conversationId || entry.accountId !== accountId) continue;
				this.mergeHydrated(entry);
			}
			this.hydratedAccounts.add(accountId);
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
			// Restored after a restart: a stored "online" was true before the restart, not now.
			// Keep it unconfirmed until WhatsApp answers the fresh subscription.
			const wasLive = Boolean(entry.online || entry.typing || entry.recording);
			this.byConversation.set(mapKey, {
				...entry,
				online: false,
				typing: false,
				recording: false,
				status: wasLive ? 'unknown' : entry.status || 'unknown',
				state: wasLive ? 'unknown' : entry.state,
			});
			if (entry.chatId) this.rememberAliases(entry.accountId, entry.conversationId, [entry.chatId]);
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
		if (!this.isSessionOwner(accountId) && (await this.redis.isAvailable())) {
			// Another server (or nobody) holds the session: Redis is the only source of truth here.
			this.sharedAccounts.set(accountId, Date.now());
			await this.refreshShared(accountId);
		} else {
			this.sharedAccounts.delete(accountId);
			await this.ensureHydrated(accountId);
		}
		return this.snapshot(accountId, options);
	}

	private snapshot(accountId: string, options?: { includeOffline?: boolean }) {
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
		this.logger.debug(
			`[WHATSAPP PRESENCE] listOnline session=${accountId} live=${items.filter((i) => i.online || i.typing || i.recording).length} totalReturned=${items.length} appliedEvents=${this.presenceEventsByAccount.get(accountId) || 0}`,
		);
		return {
			accountId,
			items,
			at: new Date().toISOString(),
		};
	}

	/** conversationId → assignedUserId, in one query. */
	async assigneesFor(conversationIds: string[]): Promise<Map<string, string | null>> {
		const ids = [...new Set(conversationIds.filter(Boolean).map(String))];
		if (!ids.length) return new Map();
		const rows = await this.conversationRepo.find({
			where: { id: In(ids) },
			select: { id: true, assignedUserId: true },
		});
		return new Map(
			rows.map((row) => [String(row.id), row.assignedUserId ? String(row.assignedUserId) : null]),
		);
	}

	/** Same rule as the inbox: assigned-only members see presence for their own chats. */
	async restrictToAssignee<T extends { items: ContactPresenceItem[] }>(snapshot: T, userId: string) {
		const assignees = await this.assigneesFor(snapshot.items.map((item) => item.conversationId));
		return {
			...snapshot,
			items: snapshot.items.filter(
				(item) => Boolean(userId) && assignees.get(String(item.conversationId)) === String(userId),
			),
		};
	}

	/** Coalesces bursts of presence events into one `online_contacts` emit per account. */
	private broadcast(accountId: string) {
		if (this.pendingBroadcast.has(accountId)) return;
		this.pendingBroadcast.add(accountId);
		void this.ensureHydrated(accountId).finally(() => {
			this.pendingBroadcast.delete(accountId);
			const snapshot = this.snapshot(accountId, { includeOffline: true });
			this.logger.debug(
				`[WHATSAPP PRESENCE] Socket.IO emit online_contacts session=${accountId} items=${snapshot.items.length}`,
			);
			void this.gateway.emitAccountSnapshotScoped(accountId, 'online_contacts', snapshot, (ids) =>
				this.assigneesFor(ids),
			);
		});
	}

	private isPresenceEligibleJid(chatId: string) {
		const id = String(chatId || '').trim().toLowerCase();
		if (!id) return false;
		if (id.endsWith('@g.us')) return false;
		if (id.includes('@newsletter')) return false;
		if (id.includes('@broadcast')) return false;
		if (id.includes('status@')) return false;
		if (id.includes('email-memo')) return false;
		return true;
	}

	/**
	 * Subscribe to WhatsApp presence for recent 1:1 chats **and** address-book contacts.
	 * Required: Baileys only streams presence after `presenceSubscribe(jid)`.
	 * Contacts without a prior chat are included so online is not limited to people you messaged.
	 */
	async subscribeRecentDirectChats(accountId: string, limit = 200, force = false) {
		const last = this.lastSubscribeAt.get(accountId) || 0;
		if (!force && Date.now() - last < 45_000) {
			return { ok: true, subscribed: 0, skipped: true };
		}
		if (this.subscribeInFlight.has(accountId)) {
			return { ok: true, subscribed: 0, skipped: true };
		}
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected' || !provider.subscribePresence) {
			this.noteSubscribe(
				accountId,
				0,
				0,
				!provider ? 'blocked: no provider (account not started)' : `blocked: provider ${provider.getState()}`,
			);
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
			const chatTake = Math.min(Math.max(Number(limit) || 200, 1), 300);
			const contactTake = Math.min(Math.max(chatTake, 1), 300);

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
				.take(chatTake)
				.getMany();

			this.seedConversationRoster(accountId, rows, { broadcast: false });

			const contacts = await this.contactRepo
				.createQueryBuilder('contact')
				.where('contact.accountId = :accountId', { accountId })
				.andWhere('LOWER(contact.waId) NOT LIKE :group', { group: '%@g.us%' })
				.andWhere('LOWER(contact.waId) NOT LIKE :newsletter', {
					newsletter: '%@newsletter%',
				})
				.andWhere('LOWER(contact.waId) NOT LIKE :broadcast', {
					broadcast: '%@broadcast%',
				})
				.andWhere('LOWER(contact.waId) NOT LIKE :status', { status: '%status@%' })
				.orderBy('contact.updated_at', 'DESC')
				.take(contactTake)
				.getMany();

			const idSet = new Set<string>();
			const pushIds = (raw: string, phoneHint?: string | null) => {
				if (!this.isPresenceEligibleJid(raw)) return;
				for (const id of expandPresenceSubscribeIds(raw, phoneHint)) {
					if (this.isPresenceEligibleJid(id)) idSet.add(id);
				}
			};

			// People who gave us a privacy token first: they are the only ones WhatsApp will report
			// real presence for, so they must never be cut by the subscribe cap.
			const tokenJids = (await provider.presenceTokenJids?.().catch(() => [] as string[])) || [];
			this.statsFor(accountId).tokenHolders = tokenJids.length;
			for (const jid of tokenJids) pushIds(jid);
			for (const row of rows) {
				pushIds(String(row.providerChatId || '').trim(), row.contact?.phoneNumber);
			}
			for (const contact of contacts) {
				let phone = contact.phoneNumber;
				const waId = String(contact.waId || '').trim();
				if (
					!phone &&
					(waId.endsWith('@lid') || waId.endsWith('@hosted.lid')) &&
					typeof provider.resolveContactIdentity === 'function'
				) {
					const identity = await provider
						.resolveContactIdentity(waId)
						.catch(() => null);
					phone = identity?.phoneNumber || null;
				}
				pushIds(waId, phone);
			}

			const chatIds = [...idSet].slice(0, PRESENCE_SUBSCRIBE_JID_CAP);
			if (!chatIds.length) {
				this.noteSubscribe(accountId, 0, 0, 'skipped: no 1:1 chats or contacts to subscribe');
				this.lastSubscribeAt.set(accountId, Date.now());
				this.logger.log(
					`[WHATSAPP PRESENCE] Subscribe skipped — no direct/contact JIDs session=${accountId}`,
				);
				return { ok: true, subscribed: 0 };
			}

			const subscribed = Number((await provider.subscribePresence(chatIds)) || 0);
			this.lastFullSubscribeAt.set(accountId, Date.now());
			const deviceAvailable = provider.isOnlinePresence?.() ?? null;
			this.noteSubscribe(
				accountId,
				chatIds.length,
				subscribed || chatIds.length,
				deviceAvailable === false
					? 'ok, but device was unavailable — WhatsApp answers "unavailable" for everyone until it is available'
					: 'ok',
			);
			this.lastSubscribeAt.set(accountId, Date.now());
			this.logger.log(
				`[WHATSAPP PRESENCE] Subscribed session=${accountId} chats=${rows.length} contactsDb=${contacts.length} jids=${chatIds.length} ok=${subscribed || chatIds.length} sample=${chatIds.slice(0, 5).join(',')}`,
			);
			return { ok: true, subscribed: subscribed || chatIds.length };
		} catch (error) {
			this.noteSubscribe(
				accountId,
				0,
				0,
				`failed: ${error instanceof Error ? error.message : String(error)}`,
			);
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
