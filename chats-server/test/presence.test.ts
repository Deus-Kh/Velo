import { describe, expect, it } from 'vitest';
import { MemoryPresenceStore, PRESENCE_TTL_SECONDS, RedisPresenceStore, type PresenceRedis } from '../src/lib/presence';

/**
 * T4.3 — presence shared through Redis (P2-4). The Redis store is exercised
 * against a fake that implements the seven commands it uses, including
 * expiry, so the TTL behaviour is pinned without a Redis server.
 */
class FakeRedis implements PresenceRedis {
  sets = new Map<string, Set<string>>();
  strings = new Map<string, string>();
  ttls = new Map<string, number>();
  now = 1_000;

  private expireCheck(key: string) {
    const until = this.ttls.get(key);
    if (until !== undefined && until <= this.now) {
      this.sets.delete(key);
      this.strings.delete(key);
      this.ttls.delete(key);
    }
  }
  async sadd(key: string, member: string) {
    this.expireCheck(key);
    const s = this.sets.get(key) ?? new Set<string>();
    const added = s.has(member) ? 0 : 1;
    s.add(member);
    this.sets.set(key, s);
    return added;
  }
  async srem(key: string, member: string) {
    this.expireCheck(key);
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async scard(key: string) {
    this.expireCheck(key);
    return this.sets.get(key)?.size ?? 0;
  }
  async expire(key: string, seconds: number) {
    if (!this.sets.has(key) && !this.strings.has(key)) return 0;
    this.ttls.set(key, this.now + seconds);
    return 1;
  }
  async set(key: string, value: string) {
    this.strings.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    this.expireCheck(key);
    return this.strings.get(key) ?? null;
  }
  async del(key: string) {
    const had = this.sets.delete(key) || this.strings.delete(key);
    this.ttls.delete(key);
    return had ? 1 : 0;
  }
}

for (const [name, make] of [
  ['memory', () => ({ store: new MemoryPresenceStore(), redis: null as FakeRedis | null })],
  ['redis', () => { const redis = new FakeRedis(); return { store: new RedisPresenceStore(redis), redis }; }],
] as const) {
  describe(`T4.3 presence (${name})`, () => {
    it('a user is online while any socket is connected; lastSeen is written when the last one leaves', async () => {
      const { store } = make();
      expect(await store.isOnline('u1')).toBe(false);
      await store.connected('u1', 's1');
      await store.connected('u1', 's2');
      expect(await store.isOnline('u1')).toBe(true);
      expect(await store.disconnected('u1', 's1', 5_000)).toBe(false);
      expect(await store.isOnline('u1')).toBe(true);
      expect(await store.lastSeen('u1')).toBeNull();
      expect(await store.disconnected('u1', 's2', 6_000)).toBe(true);
      expect(await store.isOnline('u1')).toBe(false);
      expect(await store.lastSeen('u1')).toBe(6_000);
      expect(await store.isOnline('u2')).toBe(false);
    });
  });
}

describe('T4.3 presence (redis expiry)', () => {
  it('the sockets of a dead process are forgotten after the TTL; a heartbeat keeps a live one', async () => {
    const redis = new FakeRedis();
    const store = new RedisPresenceStore(redis);
    await store.connected('u1', 'dead-process-socket');
    redis.now += (PRESENCE_TTL_SECONDS - 1);
    expect(await store.isOnline('u1')).toBe(true);
    redis.now += 2;
    expect(await store.isOnline('u1'), 'no heartbeat: the entry expired').toBe(false);

    await store.connected('u1', 'live');
    for (let i = 0; i < 5; i += 1) {
      redis.now += PRESENCE_TTL_SECONDS / 2;
      await store.heartbeat('u1', 'live');
    }
    expect(await store.isOnline('u1'), 'heartbeats refreshed the expiry').toBe(true);

    // A heartbeat after a Redis restart (key gone) restores the membership.
    redis.sets.clear();
    redis.ttls.clear();
    expect(await store.isOnline('u1')).toBe(false);
    await store.heartbeat('u1', 'live');
    expect(await store.isOnline('u1')).toBe(true);
  });

  it('keys are namespaced per user and the last socket clears the set', async () => {
    const redis = new FakeRedis();
    const store = new RedisPresenceStore(redis);
    await store.connected('u1', 's1');
    expect([...redis.sets.keys()]).toEqual(['presence:conns:u1']);
    await store.disconnected('u1', 's1', 42);
    expect(redis.sets.has('presence:conns:u1')).toBe(false);
    expect(redis.strings.get('presence:lastSeen:u1')).toBe('42');
  });
});
