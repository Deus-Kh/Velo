import Redis from 'ioredis';
import { config } from './config';

/**
 * Shared Redis client for rate limits, login backoff, and (Phase 4') presence
 * and the socket.io adapter.
 *
 * Behaviour when Redis is unreachable at boot:
 *   - development: fall back to in-memory stores and warn (single process).
 *   - production: keep the client; commands fail fast, so the auth limiter
 *     fails CLOSED (503) while the other limiters fail OPEN. The server still
 *     boots — a Redis outage must never take the whole API down.
 */

let client: Redis | null = null;

export function getRedis(): Redis | null {
  return client;
}

export async function initRedis(timeoutMs = 2000): Promise<Redis | null> {
  if (!config.REDIS_URL) {
    if (config.IS_PRODUCTION) {
      throw new Error('REDIS_URL is required in production (rate limits must be shared and durable).');
    }
    console.warn('[redis] REDIS_URL not set; using in-memory rate limits (development only).');
    client = null;
    return null;
  }

  const candidate = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    // Fail fast instead of queueing forever while disconnected.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });

  let lastState: 'up' | 'down' | null = null;
  candidate.on('error', (err) => {
    if (lastState !== 'down') console.error('[redis] connection error:', err.message);
    lastState = 'down';
  });
  candidate.on('ready', () => {
    if (lastState !== 'up') console.log('[redis] connected');
    lastState = 'up';
  });

  try {
    await Promise.race([
      candidate.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    await candidate.ping();
    client = candidate;
    return client;
  } catch (err) {
    if (config.IS_PRODUCTION) {
      console.error(
        '[redis] unreachable at boot; auth rate limiting will fail closed until it recovers:',
        (err as Error).message,
      );
      client = candidate; // keep it: ioredis will keep retrying in the background
      return client;
    }
    console.warn(
      '[redis] unreachable; falling back to in-memory rate limits (development only):',
      (err as Error).message,
    );
    candidate.disconnect();
    client = null;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}
