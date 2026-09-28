import type Redis from 'ioredis';
import { FixedWindowLimiter } from './fixedWindowLimiter';
import { createKvStore, type KeyValueStore } from './kvStore';
import { LoginThrottle } from './loginThrottle';
import { createPresenceStore, type PresenceStore } from './presence';

/**
 * Boot-time wiring of the store-backed services. Routers and the socket layer
 * read from `services` at request time, so the Redis probe can finish before
 * anything is used while modules can still be imported eagerly.
 */

export const MESSAGE_SEND_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/**
 * Prekey-bundle issue budgets (P0-4). A single requester can drain at most
 * BUNDLE_PAIR_LIMIT one-time keys of one target per hour and
 * BUNDLE_ISSUE_LIMIT in total per hour. Legitimate use is far below both:
 * a bundle is fetched only when no session exists with a peer.
 */
export const BUNDLE_PAIR_LIMIT = { limit: 5, windowSeconds: 60 * 60 } as const;
export const BUNDLE_ISSUE_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

interface Services {
  kv: KeyValueStore;
  loginThrottle: LoginThrottle;
  messageSendLimiter: FixedWindowLimiter;
  /** Fresh bundle issues per (requester, target) pair. */
  bundlePairLimiter: FixedWindowLimiter;
  /** Fresh bundle issues per requester across all targets. */
  bundleIssueLimiter: FixedWindowLimiter;
  /** T4.3: who has a live socket, shared across processes. */
  presence: PresenceStore;
}

function build(redis: Redis | null): Services {
  const kv = createKvStore(redis);
  return {
    kv,
    loginThrottle: new LoginThrottle(kv),
    messageSendLimiter: new FixedWindowLimiter(kv, { prefix: 'rl:msg', ...MESSAGE_SEND_LIMIT }),
    bundlePairLimiter: new FixedWindowLimiter(kv, { prefix: 'rl:bundle:pair', ...BUNDLE_PAIR_LIMIT }),
    bundleIssueLimiter: new FixedWindowLimiter(kv, { prefix: 'rl:bundle:req', ...BUNDLE_ISSUE_LIMIT }),
    presence: createPresenceStore(redis),
  };
}

export const services: Services = build(null);

export function configureServices(redis: Redis | null): void {
  Object.assign(services, build(redis));
}
