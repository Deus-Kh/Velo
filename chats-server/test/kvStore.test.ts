import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../src/lib/fixedWindowLimiter';
import { MemoryKeyValueStore } from '../src/lib/kvStore';

function makeClock(start = 60_000 * 1234) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('MemoryKeyValueStore', () => {
  it('stores, reads, and deletes values', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('k', 'v', 60);
    expect(await store.get('k')).toBe('v');
    await store.del('k');
    expect(await store.get('k')).toBeNull();
  });

  it('expires values after the TTL', async () => {
    const clock = makeClock();
    const store = new MemoryKeyValueStore(clock.now);
    await store.set('k', 'v', 10);
    clock.advance(9_999);
    expect(await store.get('k')).toBe('v');
    clock.advance(1);
    expect(await store.get('k')).toBeNull();
  });

  it('increments with a TTL set on creation only', async () => {
    const clock = makeClock();
    const store = new MemoryKeyValueStore(clock.now);
    expect(await store.incr('c', 10)).toBe(1);
    clock.advance(9_000);
    expect(await store.incr('c', 10)).toBe(2); // TTL not extended
    clock.advance(1_500);
    expect(await store.incr('c', 10)).toBe(1); // window expired → fresh key
  });

  it('sweeps expired entries', async () => {
    const clock = makeClock();
    const store = new MemoryKeyValueStore(clock.now);
    await store.set('a', '1', 1);
    await store.set('b', '1', 100);
    clock.advance(2_000);
    store.sweep();
    expect(store.size).toBe(1);
  });
});

describe('FixedWindowLimiter', () => {
  it('allows up to the limit within a window and blocks beyond it', async () => {
    const clock = makeClock();
    const limiter = new FixedWindowLimiter(
      new MemoryKeyValueStore(clock.now),
      { prefix: 't', limit: 3, windowSeconds: 60 },
      clock.now,
    );
    expect((await limiter.hit('u1')).allowed).toBe(true);
    expect((await limiter.hit('u1')).allowed).toBe(true);
    expect((await limiter.hit('u1')).allowed).toBe(true);
    const blocked = await limiter.hit('u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('keeps subjects independent', async () => {
    const limiter = new FixedWindowLimiter(new MemoryKeyValueStore(), {
      prefix: 't',
      limit: 1,
      windowSeconds: 60,
    });
    expect((await limiter.hit('a')).allowed).toBe(true);
    expect((await limiter.hit('b')).allowed).toBe(true);
    expect((await limiter.hit('a')).allowed).toBe(false);
  });

  it('resets at the next window', async () => {
    const clock = makeClock();
    const limiter = new FixedWindowLimiter(
      new MemoryKeyValueStore(clock.now),
      { prefix: 't', limit: 1, windowSeconds: 60 },
      clock.now,
    );
    expect((await limiter.hit('u')).allowed).toBe(true);
    expect((await limiter.hit('u')).allowed).toBe(false);
    clock.advance(60_000);
    expect((await limiter.hit('u')).allowed).toBe(true);
  });
});
