import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntitySubscriberInterface, InsertEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { RedisService } from '../../redis/redis.service';

/** Tables whose rows show up in the inbox list (names, previews, unread, pins, archive...). */
const INBOX_ENTITY_NAMES = new Set([
	'WhatsAppConversation',
	'WhatsAppConversationPreference',
	'WhatsAppConversationAssignment',
	'WhatsAppMessage',
	'WhatsAppContact',
	'WhatsAppGroup',
	'WhatsAppAccountAccess',
]);

const MEMORY_LIMIT = 500;

/**
 * Short-lived cache for inbox list pages.
 *
 * Every key carries a version made of a per-account counter and a global counter. Any write
 * to an inbox table (TypeORM subscriber) and any socket event for the account bumps the
 * counter, so a changed inbox is never served from cache; the TTL only bounds what a write
 * we cannot see (raw SQL) could leave stale.
 *
 * Values go to Redis when it is connected (RedisService handles REDIS_HOST/REDIS_ENABLED and
 * returns nothing when Redis is down) and to a small in-process map otherwise.
 */
@Injectable()
export class WhatsAppInboxCacheService implements OnModuleInit {
	private readonly logger = new Logger(WhatsAppInboxCacheService.name);
	// Start from the boot time so keys written by a previous process never match.
	private globalVersion = Date.now();
	private readonly accountVersions = new Map<string, number>();
	private readonly memory = new Map<string, { expiresAt: number; value: unknown }>();
	private readonly inFlight = new Map<string, Promise<unknown>>();

	constructor(
		@Optional() private readonly redis?: RedisService,
		@Optional() @InjectDataSource() private readonly dataSource?: DataSource,
	) {}

	onModuleInit() {
		if (!this.dataSource) return;
		const subscriber: EntitySubscriberInterface<any> = {
			afterInsert: (event: InsertEvent<any>) => this.onWrite(event.metadata?.name, event.entity),
			afterUpdate: (event: UpdateEvent<any>) =>
				this.onWrite(event.metadata?.name, event.entity || event.databaseEntity),
			afterRemove: (event: RemoveEvent<any>) =>
				this.onWrite(event.metadata?.name, event.entity || event.databaseEntity),
			afterSoftRemove: (event: any) => this.onWrite(event.metadata?.name, event.entity),
		};
		this.dataSource.subscribers.push(subscriber);
	}

	private onWrite(entityName: string | undefined, entity: any) {
		if (!entityName || !INBOX_ENTITY_NAMES.has(entityName)) return;
		const accountId = String(entity?.accountId || entity?.account_id || '').trim();
		if (accountId) this.bump(accountId);
		// Query-builder updates arrive without the row; we cannot tell which account changed.
		else this.bumpAll();
	}

	bump(accountId: string | null | undefined) {
		const id = String(accountId || '').trim();
		if (!id) return;
		this.accountVersions.set(id, (this.accountVersions.get(id) || 0) + 1);
	}

	bumpAll() {
		this.globalVersion += 1;
	}

	private versionFor(accountId: string) {
		return `${this.globalVersion}.${this.accountVersions.get(accountId) || 0}`;
	}

	keyFor(accountId: string, userId: string, params: Record<string, unknown>) {
		const hash = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16);
		return `wa:inbox:${accountId}:${this.versionFor(accountId)}:${userId}:${hash}`;
	}

	/** Cached value for `key`, or the loader's result (stored for `ttlSec`). */
	async getOrLoad<T>(accountId: string, key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
		const fromMemory = this.memory.get(key);
		if (fromMemory && fromMemory.expiresAt > Date.now()) return fromMemory.value as T;
		if (this.redis?.isReady()) {
			try {
				const cached = await this.redis.get<T>(key);
				if (cached != null) return cached;
			} catch {
				/* fall through to the loader */
			}
		}
		const running = this.inFlight.get(key);
		if (running) return running as Promise<T>;
		const versionAtStart = this.versionFor(accountId);
		const task = loader()
			.then(async (value) => {
				// A write landed while we were reading: the result may already be old; do not keep it.
				if (this.versionFor(accountId) !== versionAtStart) return value;
				const plain = JSON.parse(JSON.stringify(value));
				this.remember(key, plain, ttlSec);
				if (this.redis?.isReady()) {
					await this.redis.set(key, plain, ttlSec).catch((error) => {
						this.logger.debug(`Inbox cache write skipped: ${error?.message || error}`);
					});
				}
				return value;
			})
			.finally(() => {
				this.inFlight.delete(key);
			});
		this.inFlight.set(key, task);
		return task;
	}

	private remember(key: string, value: unknown, ttlSec: number) {
		if (this.memory.size >= MEMORY_LIMIT) {
			const now = Date.now();
			for (const [entryKey, entry] of this.memory) {
				if (entry.expiresAt <= now) this.memory.delete(entryKey);
			}
			while (this.memory.size >= MEMORY_LIMIT) {
				const oldest = this.memory.keys().next().value;
				if (oldest == null) break;
				this.memory.delete(oldest);
			}
		}
		this.memory.set(key, { expiresAt: Date.now() + ttlSec * 1000, value });
	}
}
