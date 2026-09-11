import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';
import type Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import type { AuthedRequest } from './auth';

/**
 * HTTP rate limiting (P0-5).
 *
 * | Limiter        | Window | Max          | Applied to                      | Redis down |
 * |----------------|--------|--------------|---------------------------------|------------|
 * | globalLimiter  | 15 min | 1000 / IP    | every route                     | fail open  |
 * | authLimiter    | 15 min | 10 / IP      | /auth/login, /auth/register     | fail CLOSED|
 * | bundleLimiter  | 1 h    | 120 / user   | /keys/bundle/:userId (coarse)   | fail open  |
 *
 * bundleLimiter is only a coarse request cap; the drain-relevant budgets
 * (5 issues per pair per hour, 30 per requester per hour) live in the route
 * handler on top of the KeyValueStore — see lib/services.ts.
 *
 * The limiters are created at boot (after the Redis probe) via
 * configureRateLimiters(); the exported handlers delegate to whatever is
 * current, so routers can reference them at import time.
 */

export class RateLimitBackendUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Rate-limit backend unavailable');
    this.name = 'RateLimitBackendUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

export const RATE_LIMITS = {
  global: { windowMs: 15 * 60 * 1000, limit: 1000 },
  auth: { windowMs: 15 * 60 * 1000, limit: 10 },
  bundle: { windowMs: 60 * 60 * 1000, limit: 120 },
} as const;

function rateLimitedResponse(req: Request, res: Response): void {
  const resetHeader = res.getHeader('RateLimit-Reset');
  const retryAfterSeconds = typeof resetHeader === 'string' ? Number(resetHeader) : undefined;
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }
  res.status(429).json({
    error: 'Too many requests. Please wait and try again.',
    code: 'RATE_LIMITED',
    retryAfterSeconds: retryAfterSeconds ?? null,
  });
}

function makeRedisStore(redis: Redis, prefix: string): Store {
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      try {
        // ioredis: call(command, ...args)
        return (await redis.call(args[0], ...args.slice(1))) as never;
      } catch (err) {
        throw new RateLimitBackendUnavailableError(err);
      }
    },
  });
}

function userOrIpKey(req: Request): string {
  const userId = (req as AuthedRequest).userId;
  return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? '');
}

interface Limiters {
  global: RequestHandler;
  auth: RequestHandler;
  bundle: RequestHandler;
}

function buildLimiters(redis: Redis | null): Limiters {
  const store = (prefix: string): Store | undefined =>
    redis ? makeRedisStore(redis, prefix) : undefined; // undefined → express-rate-limit MemoryStore

  return {
    global: rateLimit({
      ...RATE_LIMITS.global,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: rateLimitedResponse,
      store: store('rl:global:'),
      passOnStoreError: true,
    }),
    auth: rateLimit({
      ...RATE_LIMITS.auth,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: rateLimitedResponse,
      store: store('rl:auth:'),
      // Fail CLOSED: with no backend we cannot bound brute force, so refuse.
      passOnStoreError: false,
    }),
    bundle: rateLimit({
      ...RATE_LIMITS.bundle,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: rateLimitedResponse,
      keyGenerator: userOrIpKey,
      store: store('rl:bundle:'),
      passOnStoreError: true,
    }),
  };
}

// Memory-backed defaults so imports work before boot (and in unit tests).
let current: Limiters = buildLimiters(null);

export function configureRateLimiters(redis: Redis | null): void {
  current = buildLimiters(redis);
}

export const globalLimiter: RequestHandler = (req, res, next) => current.global(req, res, next);
export const authLimiter: RequestHandler = (req, res, next) => current.auth(req, res, next);
export const bundleLimiter: RequestHandler = (req, res, next) => current.bundle(req, res, next);
