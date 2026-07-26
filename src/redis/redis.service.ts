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
    if (!this.isReady() || !this.client) return;
    let cursor: any = 0;
    let keys: string[] = [];

    do {
      const result = await this.client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      cursor = result.cursor;
      keys = keys.concat(result.keys);
    } while (cursor !== 0);

    if (keys.length > 0) {
      await this.client.del(keys);
    }
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
