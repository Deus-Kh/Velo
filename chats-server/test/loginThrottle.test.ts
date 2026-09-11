import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from '../src/lib/kvStore';
import {
  LOGIN_FAILURE_TTL_SECONDS,
  LoginThrottle,
  MAX_LOGIN_DELAY_SECONDS,
  loginDelaySeconds,
  loginFailureKey,
} from '../src/lib/loginThrottle';

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('loginDelaySeconds', () => {
  it('doubles per failure and caps at the maximum', () => {
    expect(loginDelaySeconds(0)).toBe(0);
    expect(loginDelaySeconds(1)).toBe(2);
    expect(loginDelaySeconds(2)).toBe(4);
    expect(loginDelaySeconds(3)).toBe(8);
    expect(loginDelaySeconds(8)).toBe(256);
    expect(loginDelaySeconds(9)).toBe(MAX_LOGIN_DELAY_SECONDS);
    expect(loginDelaySeconds(50)).toBe(MAX_LOGIN_DELAY_SECONDS);
  });
});

describe('loginFailureKey', () => {
  it('hashes the normalised email and never embeds it', () => {
    const key = loginFailureKey('  Alice@Example.COM ');
    expect(key).toBe(loginFailureKey('alice@example.com'));
    expect(key).toMatch(/^login:fail:[0-9a-f]{64}$/);
    expect(key).not.toContain('alice');
  });
});

describe('LoginThrottle', () => {
  it('is open for an unknown account', async () => {
    const throttle = new LoginThrottle(new MemoryKeyValueStore());
    expect(await throttle.check('nobody@example.com')).toEqual({ blocked: false, retryAfterSeconds: 0 });
  });

  it('applies increasing delays after consecutive failures', async () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(new MemoryKeyValueStore(clock.now), clock.now);
    const email = 'victim@example.com';

    expect(await throttle.recordFailure(email)).toEqual({ failures: 1, retryAfterSeconds: 2 });
    expect(await throttle.check(email)).toEqual({ blocked: true, retryAfterSeconds: 2 });

    clock.advance(2_000);
    expect((await throttle.check(email)).blocked).toBe(false);

    expect(await throttle.recordFailure(email)).toEqual({ failures: 2, retryAfterSeconds: 4 });
    expect(await throttle.recordFailure(email)).toEqual({ failures: 3, retryAfterSeconds: 8 });
    const state = await throttle.check(email);
    expect(state.blocked).toBe(true);
    expect(state.retryAfterSeconds).toBe(8);
  });

  it('reports the remaining lock time, rounded up', async () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(new MemoryKeyValueStore(clock.now), clock.now);
    await throttle.recordFailure('a@example.com');
    await throttle.recordFailure('a@example.com'); // 4s lock
    clock.advance(1_500);
    expect(await throttle.check('a@example.com')).toEqual({ blocked: true, retryAfterSeconds: 3 });
  });

  it('caps the delay at the maximum', async () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(new MemoryKeyValueStore(clock.now), clock.now);
    let last = { failures: 0, retryAfterSeconds: 0 };
    for (let i = 0; i < 12; i += 1) last = await throttle.recordFailure('b@example.com');
    expect(last.failures).toBe(12);
    expect(last.retryAfterSeconds).toBe(MAX_LOGIN_DELAY_SECONDS);
  });

  it('clears the record on success', async () => {
    const throttle = new LoginThrottle(new MemoryKeyValueStore());
    await throttle.recordFailure('c@example.com');
    await throttle.recordSuccess('c@example.com');
    expect(await throttle.check('c@example.com')).toEqual({ blocked: false, retryAfterSeconds: 0 });
    expect(await throttle.recordFailure('c@example.com')).toEqual({ failures: 1, retryAfterSeconds: 2 });
  });

  it('forgets failures after the record TTL', async () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(new MemoryKeyValueStore(clock.now), clock.now);
    await throttle.recordFailure('d@example.com');
    await throttle.recordFailure('d@example.com');
    clock.advance(LOGIN_FAILURE_TTL_SECONDS * 1000 + 1);
    expect(await throttle.recordFailure('d@example.com')).toEqual({ failures: 1, retryAfterSeconds: 2 });
  });

  it('treats a corrupted record as no record', async () => {
    const store = new MemoryKeyValueStore();
    await store.set(loginFailureKey('e@example.com'), 'not json', 60);
    const throttle = new LoginThrottle(store);
    expect(await throttle.check('e@example.com')).toEqual({ blocked: false, retryAfterSeconds: 0 });
  });
});
