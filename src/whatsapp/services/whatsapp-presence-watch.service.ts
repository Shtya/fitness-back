import {
	BadRequestException,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { RedisService } from '../../redis/redis.service';
import { WebPushService } from '../../notification/web-push.service';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppAccessService } from './whatsapp-access.service';
import {
	ContactPresenceItem,
	WhatsAppContactPresenceService,
} from './whatsapp-contact-presence.service';

/** One alert per watcher per contact inside this window — WhatsApp flaps online/offline a lot. */
export const PRESENCE_WATCH_COOLDOWN_SEC = 10 * 60;
/** Upper bound per user and account, so one person can't subscribe the whole address book. */
export const PRESENCE_WATCH_MAX = 50;

export const PRESENCE_WATCH_EVENT = 'whatsapp:presence-watch';

/**
 * "Tell me when this person comes online."
 * Watches live in Redis (no schema change): one set of conversation ids per user and account,
 * plus a set of users per account so a presence event finds its watchers without a scan.
 * Alerts only follow real WhatsApp presence transitions reported by the linked device.
 */
@Injectable()
export class WhatsAppPresenceWatchService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppPresenceWatchService.name);
	/** accountId → conversationId → watcher user ids (memory mirror of Redis). */
	private readonly watchers = new Map<string, Map<string, Set<string>>>();
	private readonly loading = new Map<string, Promise<void>>();
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly contactPresence: WhatsAppContactPresenceService,
		private readonly redis: RedisService,
		private readonly gateway: WhatsAppGateway,
		private readonly webPush: WebPushService,
		private readonly access: WhatsAppAccessService,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
	) {}

	onModuleInit() {
		this.unsubscribe = this.contactPresence.onCameOnline((entry) => {
			void this.notifyWatchers(entry);
		});
	}

	onModuleDestroy() {
		this.unsubscribe?.();
	}

	private userKey(accountId: string, userId: string) {
		return `wa:presence:watch:${accountId}:${userId}`;
	}

	private usersKey(accountId: string) {
		return `wa:presence:watchusers:${accountId}`;
	}

	private cooldownKey(accountId: string, conversationId: string, userId: string) {
		return `wa:presence:watchsent:${accountId}:${conversationId}:${userId}`;
	}

	private async requireRedis() {
		if (!(await this.redis.isAvailable())) {
			throw new ServiceUnavailableException(
				'Presence alerts are unavailable right now (storage offline). Nothing was saved.',
			);
		}
		return this.redis.getClient();
	}

	private ensureLoaded(accountId: string): Promise<void> {
		if (this.watchers.has(accountId)) return Promise.resolve();
		let pending = this.loading.get(accountId);
		if (!pending) {
			pending = this.load(accountId).finally(() => this.loading.delete(accountId));
			this.loading.set(accountId, pending);
		}
		return pending;
	}

	private async load(accountId: string) {
		const byConversation = new Map<string, Set<string>>();
		if (await this.redis.isAvailable()) {
			const userIds = await this.redis.sMembers(this.usersKey(accountId));
			for (const userId of userIds) {
				const ids = await this.redis.sMembers(this.userKey(accountId, userId));
				for (const conversationId of ids) {
					if (!byConversation.has(conversationId)) byConversation.set(conversationId, new Set());
					byConversation.get(conversationId)!.add(userId);
				}
			}
			this.watchers.set(accountId, byConversation);
		}
		// Redis down: leave unloaded so the next event retries instead of caching "nobody".
	}

	async list(accountId: string, userId: string): Promise<string[]> {
		if (!(await this.redis.isAvailable())) return [];
		return this.redis.sMembers(this.userKey(accountId, userId));
	}

	async setWatch(accountId: string, userId: string, conversationId: string, watch: boolean) {
		const client = await this.requireRedis();
		const key = this.userKey(accountId, userId);
		if (watch) {
			const current = await this.redis.sMembers(key);
			if (!current.includes(conversationId) && current.length >= PRESENCE_WATCH_MAX) {
				throw new BadRequestException(
					`You can follow up to ${PRESENCE_WATCH_MAX} people per WhatsApp account.`,
				);
			}
			await client.multi().sAdd(key, conversationId).sAdd(this.usersKey(accountId), userId).exec();
		} else {
			await client.sRem(key, conversationId);
			if (!(await client.sCard(key))) await client.sRem(this.usersKey(accountId), userId);
		}
		await this.ensureLoaded(accountId);
		const map = this.watchers.get(accountId);
		if (map) {
			if (!map.has(conversationId)) map.set(conversationId, new Set());
			const set = map.get(conversationId)!;
			if (watch) set.add(userId);
			else set.delete(userId);
		}
		return this.list(accountId, userId);
	}

	/** Watchers still allowed to see this chat (access can change after they started watching). */
	private async allowedWatchers(conversationId: string, userIds: string[]) {
		const allowed: string[] = [];
		for (const userId of userIds) {
			const user = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
			if (!user) continue;
			try {
				await this.access.assertConversationVisible(user, conversationId);
				allowed.push(userId);
			} catch {
				/* no longer visible to this user — skip silently */
			}
		}
		return allowed;
	}

	async notifyWatchers(entry: ContactPresenceItem) {
		try {
			await this.ensureLoaded(entry.accountId);
			const userIds = [...(this.watchers.get(entry.accountId)?.get(entry.conversationId) || [])];
			if (!userIds.length) return;
			const client = await this.requireRedis().catch(() => null);
			if (!client) return;
			const allowed = await this.allowedWatchers(entry.conversationId, userIds);
			for (const userId of allowed) {
				const fresh = await client.set(
					this.cooldownKey(entry.accountId, entry.conversationId, userId),
					String(Date.now()),
					{ NX: true, EX: PRESENCE_WATCH_COOLDOWN_SEC },
				);
				if (!fresh) continue;
				const payload = {
					accountId: entry.accountId,
					conversationId: entry.conversationId,
					name: entry.name,
					avatarUrl: entry.avatarUrl,
					status: entry.status,
					at: new Date(entry.updatedAt || Date.now()).toISOString(),
				};
				this.gateway.emitToUser(userId, PRESENCE_WATCH_EVENT, payload);
				void this.webPush
					.sendToUser(userId, {
						title: entry.name || 'WhatsApp',
						body: 'متصل الآن على واتساب · Online now on WhatsApp',
						url: `/dashboard/whatsapp?accountId=${encodeURIComponent(entry.accountId)}&conversationId=${encodeURIComponent(entry.conversationId)}`,
						tag: `presence-${entry.conversationId}`,
						data: { type: 'presence-online', accountId: entry.accountId, conversationId: entry.conversationId },
					})
					.catch(() => undefined);
				this.logger.log(
					`[WHATSAPP PRESENCE] watch alert session=${entry.accountId} conversation=${entry.conversationId} user=${userId}`,
				);
			}
		} catch (error) {
			this.logger.warn(
				`[WHATSAPP PRESENCE] watch alert failed session=${entry.accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}
