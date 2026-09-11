import type Redis from 'ioredis';

/**
 * Minimal key/value store used by the login backoff and the socket message
 * limiter. Two implementations: Redis (shared, survives restarts) and an
 * in-memory map (development, tests, or Redis outage fallback).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Increments `key` and returns the new value; sets the TTL when the key is created. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): { value: string; expiresAt: number } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) {
      this.entries.set(key, { value: '1', expiresAt: this.now() + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }

  /** Test helper: drop expired entries. Production callers never need this. */
  sweep(): void {
    for (const key of Array.from(this.entries.keys())) this.live(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.redis.incr(key);
    // Set the window only when the key was just created; a TTL race here costs
    // at most one extra window for one key and is acceptable for rate limiting.
    if (next === 1) await this.redis.expire(key, ttlSeconds);
    return next;
  }
}

export function createKvStore(redis: Redis | null): KeyValueStore {
  return redis ? new RedisKeyValueStore(redis) : new MemoryKeyValueStore();
}
