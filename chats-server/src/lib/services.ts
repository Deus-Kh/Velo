import type Redis from 'ioredis';
import { FixedWindowLimiter } from './fixedWindowLimiter';
import { createKvStore, type KeyValueStore } from './kvStore';
import { LoginThrottle } from './loginThrottle';

/**
 * Boot-time wiring of the store-backed services. Routers and the socket layer
 * read from `services` at request time, so the Redis probe can finish before
 * anything is used while modules can still be imported eagerly.
 */

export const MESSAGE_SEND_LIMIT = { limit: 60, windowSeconds: 60 } as const;

interface Services {
  kv: KeyValueStore;
  loginThrottle: LoginThrottle;
  messageSendLimiter: FixedWindowLimiter;
}

function build(redis: Redis | null): Services {
  const kv = createKvStore(redis);
  return {
    kv,
    loginThrottle: new LoginThrottle(kv),
    messageSendLimiter: new FixedWindowLimiter(kv, { prefix: 'rl:msg', ...MESSAGE_SEND_LIMIT }),
  };
}

export const services: Services = build(null);

export function configureServices(redis: Redis | null): void {
  Object.assign(services, build(redis));
}
