// src/redis/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
 
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;

  async onModuleInit() {
    this.client = createClient({
      socket: {
        host: process.env.REDIS_HOST ,
        port: process.env.REDIS_PORT as any ,
      },
      username: process.env.REDIS_USERNAME ,
      password: process.env.REDIS_PASSWORD ,
    });

    this.client.on('error', err => console.log('Redis Client Error', err));

    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value: any = await this.client.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // Add pattern deletion methods
  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  // Alternative: More efficient scanning for large datasets
  async deletePatternScan(pattern: string): Promise<void> {
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
    await this.client.flushAll();
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const result: any = await this.client.expire(key, ttl);
    return result;
  }
}
