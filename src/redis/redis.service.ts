// src/redis/redis.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private ready = false;
  private readonly pingTimeoutMs = 2_000;

  private isEnabled(): boolean {
    const flag = process.env.REDIS_ENABLED;
    if (flag === undefined || flag === '') return true;
    return !['0', 'false', 'no', 'off'].includes(flag.trim().toLowerCase());
  }

  async onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.warn(
        'Redis disabled via REDIS_ENABLED — continuing without Redis',
      );
      return;
    }

    if (!process.env.REDIS_HOST) {
      this.logger.warn('REDIS_HOST not set — continuing without Redis');
      return;
    }

    this.client = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT) || 6379,
        connectTimeout: 5_000,
      },
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
    });

    this.client.on('error', err => {
      this.ready = false;
      this.logger.error(`Redis Client Error: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.client.on('ready', () => {
      this.ready = true;
    });
    this.client.on('end', () => {
      this.ready = false;
    });

    try {
      await this.client.connect();
      await this.pingWithTimeout();
      this.ready = true;
      this.logger.log('Redis connected');
    } catch (error) {
      this.ready = false;
      this.logger.warn(
        `Redis unavailable at startup — continuing without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    try {
      if (this.client.isOpen) {
        await this.client.quit();
      }
    } catch (error) {
      this.logger.warn(
        `Redis quit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ready = false;
      this.client = null;
    }
  }

  /** Sync readiness: client socket is open and ready for commands. */
  isReady(): boolean {
    return Boolean(this.client?.isOpen && this.client?.isReady);
  }

  /**
   * Reliable availability check: ready state plus a short ping.
   * Returns false (does not throw) when Redis is down, slow, or disabled.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client?.isOpen || !this.client?.isReady) {
      return false;
    }
    try {
      await this.pingWithTimeout();
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  private async pingWithTimeout(): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }
    await Promise.race([
      this.client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Redis ping timed out after ${this.pingTimeoutMs}ms`)),
          this.pingTimeoutMs,
        ),
      ),
    ]);
  }

  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client is not available');
    }
    return this.client;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.isReady() || !this.client) return;
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isReady() || !this.client) return null;
    const value: any = await this.client.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isReady() || !this.client) return;
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isReady() || !this.client) return false;
    const result = await this.client.exists(key);
    return result === 1;
  }

  // Add pattern deletion methods
  async deletePattern(pattern: string): Promise<void> {
    if (!this.isReady() || !this.client) return;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  // Alternative: More efficient scanning for large datasets
  async deletePatternScan(pattern: string): Promise<void> {
    const keys = await this.scanKeys(pattern);
    if (keys.length > 0 && this.client) {
      await this.client.del(keys);
    }
  }

  /** Non-blocking alternative to KEYS (SCAN cursor is a string in node-redis v5). */
  async scanKeys(pattern: string, count = 200): Promise<string[]> {
    if (!this.isReady() || !this.client) return [];
    const keys: string[] = [];
    let cursor: any = '0';
    do {
      const result: any = await this.client.scan(cursor, { MATCH: pattern, COUNT: count });
      cursor = result.cursor;
      keys.push(...(result.keys || []));
    } while (String(cursor) !== '0');
    return keys;
  }

  /** One round-trip read of many JSON values; missing keys map to null. */
  async mGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (!keys.length || !this.isReady() || !this.client) return keys.map(() => null);
    const values: any[] = await this.client.mGet(keys);
    return values.map(value => {
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T;
      }
    });
  }

  async sMembers(key: string): Promise<string[]> {
    if (!this.isReady() || !this.client) return [];
    return (await this.client.sMembers(key)) as string[];
  }

  /** SET value (with TTL) and register `member` in the `indexKey` set in one MULTI round-trip. */
  async setWithIndex(
    key: string,
    value: any,
    ttlSec: number,
    indexKey: string,
    member: string,
    indexTtlSec: number,
  ): Promise<void> {
    if (!this.isReady() || !this.client) return;
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client
      .multi()
      .setEx(key, ttlSec, stringValue)
      .sAdd(indexKey, member)
      .expire(indexKey, indexTtlSec)
      .exec();
  }

  /** DEL keys and remove `members` from the `indexKey` set in one MULTI round-trip. */
  async delWithIndex(keys: string[], indexKey: string, members: string[]): Promise<void> {
    if (!keys.length || !this.isReady() || !this.client) return;
    const tx = this.client.multi().del(keys);
    if (members.length) tx.sRem(indexKey, members);
    await tx.exec();
  }

  // Additional utility methods
  async flushAll(): Promise<void> {
    if (!this.isReady() || !this.client) return;
    await this.client.flushAll();
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isReady() || !this.client) return [];
    return await this.client.keys(pattern);
  }

  async ttl(key: string): Promise<number> {
    if (!this.isReady() || !this.client) return -2;
    return await this.client.ttl(key);
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.isReady() || !this.client) return false;
    const result: any = await this.client.expire(key, ttl);
    return result;
  }
}
