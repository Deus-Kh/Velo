/**
 * Presence (T4.3, P2-4): which users have a live socket, shared across
 * server processes. Before T4.3 this was two Maps in one process, so a
 * second instance (or a restart) lost every "online" flag and push routing
 * could double-send or never send.
 *
 * Model: one set of socket ids per user, refreshed by a heartbeat. A user is
 * online while the set is non-empty. The set expires PRESENCE_TTL_SECONDS
 * after the last heartbeat, so the sockets of a process that died without
 * cleaning up are forgotten within that window (documented limit: such a
 * user may read as online for up to the TTL). lastSeen is written when the
 * last socket of a user leaves.
 */
export const PRESENCE_TTL_SECONDS = 120;
export const PRESENCE_HEARTBEAT_MS = 60_000;

export interface PresenceStore {
  connected(userId: string, socketId: string): Promise<void>;
  /** Refreshes the expiry of the user's set (called on the heartbeat). */
  heartbeat(userId: string, socketId: string): Promise<void>;
  /** Returns true when this was the user's last socket. */
  disconnected(userId: string, socketId: string, now?: number): Promise<boolean>;
  isOnline(userId: string): Promise<boolean>;
  lastSeen(userId: string): Promise<number | null>;
}

export class MemoryPresenceStore implements PresenceStore {
  private readonly sockets = new Map<string, Set<string>>();
  private readonly lastSeenAt = new Map<string, number>();

  async connected(userId: string, socketId: string): Promise<void> {
    const set = this.sockets.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.sockets.set(userId, set);
  }

  async heartbeat(): Promise<void> {
    /* nothing expires in memory: a dead process takes its map with it */
  }

  async disconnected(userId: string, socketId: string, now: number = Date.now()): Promise<boolean> {
    const set = this.sockets.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size > 0) return false;
    this.sockets.delete(userId);
    this.lastSeenAt.set(userId, now);
    return true;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  async lastSeen(userId: string): Promise<number | null> {
    return this.lastSeenAt.get(userId) ?? null;
  }
}

/** The subset of ioredis this store uses; a fake implements it in tests. */
export interface PresenceRedis {
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: PresenceRedis, private readonly ttlSeconds: number = PRESENCE_TTL_SECONDS) {}

  private setKey(userId: string): string {
    return 'presence:conns:' + userId;
  }

  private lastSeenKey(userId: string): string {
    return 'presence:lastSeen:' + userId;
  }

  async connected(userId: string, socketId: string): Promise<void> {
    await this.redis.sadd(this.setKey(userId), socketId);
    await this.redis.expire(this.setKey(userId), this.ttlSeconds);
  }

  async heartbeat(userId: string, socketId: string): Promise<void> {
    // Re-add too: if the key expired while this socket was alive (Redis restart), it comes back.
    await this.redis.sadd(this.setKey(userId), socketId);
    await this.redis.expire(this.setKey(userId), this.ttlSeconds);
  }

  async disconnected(userId: string, socketId: string, now: number = Date.now()): Promise<boolean> {
    await this.redis.srem(this.setKey(userId), socketId);
    const remaining = await this.redis.scard(this.setKey(userId));
    if (remaining > 0) return false;
    await this.redis.del(this.setKey(userId));
    await this.redis.set(this.lastSeenKey(userId), String(now));
    return true;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(this.setKey(userId))) > 0;
  }

  async lastSeen(userId: string): Promise<number | null> {
    const raw = await this.redis.get(this.lastSeenKey(userId));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
}

export function createPresenceStore(redis: PresenceRedis | null): PresenceStore {
  return redis ? new RedisPresenceStore(redis) : new MemoryPresenceStore();
}
