import type { KeyValueStore } from './kvStore';

/**
 * Fixed-window counter on top of a KeyValueStore. Used for the per-user
 * socket message limit (express-rate-limit only covers HTTP).
 */
export class FixedWindowLimiter {
  constructor(
    private readonly store: KeyValueStore,
    private readonly opts: { prefix: string; limit: number; windowSeconds: number },
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records one hit for `subject` and reports whether it is within the limit.
   * `retryAfterSeconds` is the time left in the current window when blocked.
   */
  async hit(subject: string): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
    const windowMs = this.opts.windowSeconds * 1000;
    const nowMs = this.now();
    const bucket = Math.floor(nowMs / windowMs);
    const key = `${this.opts.prefix}:${subject}:${bucket}`;
    const count = await this.store.incr(key, this.opts.windowSeconds + 1);
    const allowed = count <= this.opts.limit;
    const retryAfterSeconds = allowed ? 0 : Math.ceil(((bucket + 1) * windowMs - nowMs) / 1000);
    return { allowed, count, retryAfterSeconds };
  }
}
