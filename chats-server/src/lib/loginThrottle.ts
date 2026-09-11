import { createHash } from 'crypto';
import type { KeyValueStore } from './kvStore';

/**
 * Per-account progressive backoff on failed logins (P0-5).
 *
 * After `n` consecutive failures the account is locked for min(2^n, 300)
 * seconds. The record expires an hour after the last failure and is deleted
 * on a successful login. Keyed on a SHA-256 of the normalised email, never the
 * raw address: store keys end up in logs and dumps.
 *
 * This complements the per-IP limiter on /auth/*: the IP limiter stops one
 * attacker hammering many accounts; this stops many IPs hammering one account.
 */

export const MAX_LOGIN_DELAY_SECONDS = 300;
export const LOGIN_FAILURE_TTL_SECONDS = 60 * 60;

interface FailureRecord {
  failures: number;
  lockUntil: number; // epoch ms
}

export function loginDelaySeconds(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(2 ** failures, MAX_LOGIN_DELAY_SECONDS);
}

export function loginFailureKey(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `login:fail:${digest}`;
}

export class LoginThrottle {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  private async read(email: string): Promise<FailureRecord | null> {
    const raw = await this.store.get(loginFailureKey(email));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<FailureRecord>;
      if (typeof parsed.failures !== 'number' || typeof parsed.lockUntil !== 'number') return null;
      return { failures: parsed.failures, lockUntil: parsed.lockUntil };
    } catch {
      return null;
    }
  }

  /** Call before verifying credentials. */
  async check(email: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
    const record = await this.read(email);
    if (!record) return { blocked: false, retryAfterSeconds: 0 };
    const remainingMs = record.lockUntil - this.now();
    if (remainingMs <= 0) return { blocked: false, retryAfterSeconds: 0 };
    return { blocked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  }

  /** Call after a failed credential check. Returns the delay now in force. */
  async recordFailure(email: string): Promise<{ failures: number; retryAfterSeconds: number }> {
    const previous = await this.read(email);
    const failures = (previous?.failures ?? 0) + 1;
    const retryAfterSeconds = loginDelaySeconds(failures);
    const record: FailureRecord = {
      failures,
      lockUntil: this.now() + retryAfterSeconds * 1000,
    };
    await this.store.set(loginFailureKey(email), JSON.stringify(record), LOGIN_FAILURE_TTL_SECONDS);
    return { failures, retryAfterSeconds };
  }

  /** Call after a successful login. */
  async recordSuccess(email: string): Promise<void> {
    await this.store.del(loginFailureKey(email));
  }
}
