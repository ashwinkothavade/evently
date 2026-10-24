import type { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * Small cache abstraction over Redis. All operations fail open: a cache outage
 * only means more traffic reaches Postgres, never a failed request.
 */
export class Cache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  private async safely<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await op();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Cache operation failed; continuing without cache');
      return fallback;
    }
  }

  private key(key: string) {
    return `${this.prefix}:${key}`;
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.safely(async () => {
      const raw = await this.redis.get(this.key(key));
      return raw === null ? undefined : (JSON.parse(raw) as T);
    }, undefined);
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    return this.safely(async () => {
      if (ttlSeconds > 0) await this.redis.set(this.key(key), JSON.stringify(value), 'EX', ttlSeconds);
    }, undefined);
  }

  del(key: string): Promise<void> {
    return this.safely(async () => {
      await this.redis.del(this.key(key));
    }, undefined);
  }

  incr(key: string): Promise<number> {
    return this.safely(() => this.redis.incr(this.key(key)), Date.now());
  }

  /** Read-through helper. */
  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
