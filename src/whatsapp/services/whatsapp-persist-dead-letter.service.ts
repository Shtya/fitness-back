import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { NormalizedWhatsAppMessage } from '../providers/whatsapp-provider';

export type DeadLetterMessage = {
	accountId: string;
	message: NormalizedWhatsAppMessage;
	context: string;
	attempts: number;
	failedAt: string;
	lastError: string;
};

type Replay = (entry: DeadLetterMessage) => Promise<unknown>;

export const DEAD_LETTER_KEY = 'wa:persist:dlq:messages';
export const DEAD_LETTER_PARKED_KEY = 'wa:persist:dlq:messages:parked';
const MAX_QUEUE = 5_000;
const MAX_MEMORY_QUEUE = 1_000;
const MAX_ATTEMPTS = 20;
const DRAIN_BATCH = 50;
const DRAIN_EVERY_MS = 60_000;

/** Buffers / Uint8Array (Baileys mediaKey, sha256…) must survive the round-trip for later media download. */
export function serializeDeadLetter(entry: DeadLetterMessage): string {
	return JSON.stringify(entry, function replacer(key, value) {
		const original = (this as any)[key];
		if (original instanceof Uint8Array) {
			return { __waBuf: Buffer.from(original).toString('base64') };
		}
		return value;
	});
}

export function parseDeadLetter(raw: string): DeadLetterMessage | null {
	try {
		const entry = JSON.parse(raw, (_key, value) =>
			value && typeof value === 'object' && typeof value.__waBuf === 'string'
				? Buffer.from(value.__waBuf, 'base64')
				: value,
		) as DeadLetterMessage;
		if (!entry?.accountId || !entry?.message?.providerMessageId) return null;
		entry.message.timestamp = new Date(entry.message.timestamp as any);
		return entry;
	} catch {
		return null;
	}
}

/**
 * Live inbound messages whose persistence failed after in-queue retries.
 * Stored in Redis (memory fallback) and replayed periodically so a DB blip
 * does not silently drop a customer message.
 */
@Injectable()
export class WhatsAppPersistDeadLetterService implements OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppPersistDeadLetterService.name);
	private readonly memory: string[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private replay: Replay | null = null;
	private draining = false;

	constructor(private readonly redis: RedisService) {}

	start(replay: Replay) {
		this.replay = replay;
		if (this.timer) return;
		this.timer = setInterval(() => void this.drain(), DRAIN_EVERY_MS);
		if (typeof this.timer.unref === 'function') this.timer.unref();
	}

	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async add(
		accountId: string,
		message: NormalizedWhatsAppMessage,
		context: string,
		error: unknown,
	) {
		const entry: DeadLetterMessage = {
			accountId,
			message,
			context,
			attempts: 0,
			failedAt: new Date().toISOString(),
			lastError: error instanceof Error ? error.message : String(error),
		};
		await this.push(DEAD_LETTER_KEY, serializeDeadLetter(entry));
		this.logger.error(
			`WhatsApp message moved to dead-letter queue (${context}): ${entry.lastError}`,
		);
	}

	async size(): Promise<number> {
		const client = this.readyClient();
		const stored = client ? Number(await client.lLen(DEAD_LETTER_KEY)) : 0;
		return stored + this.memory.length;
	}

	async drain(): Promise<{ replayed: number; requeued: number; parked: number }> {
		const result = { replayed: 0, requeued: 0, parked: 0 };
		if (this.draining || !this.replay) return result;
		this.draining = true;
		try {
			const batch = await this.takeBatch();
			for (const raw of batch) {
				const entry = parseDeadLetter(raw);
				if (!entry) continue;
				try {
					await this.replay(entry);
					result.replayed += 1;
				} catch (error) {
					entry.attempts += 1;
					entry.lastError = error instanceof Error ? error.message : String(error);
					if (entry.attempts >= MAX_ATTEMPTS) {
						await this.push(DEAD_LETTER_PARKED_KEY, serializeDeadLetter(entry));
						result.parked += 1;
						this.logger.error(
							`WhatsApp dead-letter parked after ${entry.attempts} replays (${entry.context}): ${entry.lastError}`,
						);
					} else {
						await this.push(DEAD_LETTER_KEY, serializeDeadLetter(entry));
						result.requeued += 1;
					}
				}
			}
			if (result.replayed || result.parked) {
				this.logger.log(
					`WhatsApp dead-letter drain replayed=${result.replayed} requeued=${result.requeued} parked=${result.parked}`,
				);
			}
			return result;
		} finally {
			this.draining = false;
		}
	}

	private readyClient() {
		return this.redis.isReady() ? this.redis.getClient() : null;
	}

	private async push(key: string, value: string) {
		const client = this.readyClient();
		if (client) {
			try {
				await client.rPush(key, value);
				await client.lTrim(key, -MAX_QUEUE, -1);
				return;
			} catch (error) {
				this.logger.warn(
					`Dead-letter Redis push failed, keeping in memory: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		if (key !== DEAD_LETTER_KEY) {
			this.logger.error('Redis unavailable; parked dead-letter kept in memory for another replay');
		}
		this.memory.push(value);
		if (this.memory.length > MAX_MEMORY_QUEUE) {
			this.memory.shift();
			this.logger.error('In-memory dead-letter queue full; oldest entry dropped');
		}
	}

	private async takeBatch(): Promise<string[]> {
		const fromMemory = this.memory.splice(0, DRAIN_BATCH);
		const client = this.readyClient();
		if (!client || fromMemory.length >= DRAIN_BATCH) return fromMemory;
		const stored = (await client.lPopCount(DEAD_LETTER_KEY, DRAIN_BATCH - fromMemory.length)) as
			| string[]
			| null;
		return [...fromMemory, ...(stored || [])];
	}
}
