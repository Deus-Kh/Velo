/**
 * One-time prekey replenishment policy (pure; no I/O).
 *
 * The server hands out one one-time prekey per session establishment and
 * silently issues bundles without one when the pool is empty, which weakens
 * forward secrecy for that handshake. The client therefore keeps the pool
 * topped up: at login, on every return to the foreground, and at most every
 * TOP_UP_CHECK_INTERVAL_MS otherwise.
 */
export const MIN_UNUSED_ONE_TIME_PREKEYS = 30;
export const TARGET_UNUSED_ONE_TIME_PREKEYS = 100;
export const MAX_ONE_TIME_PREKEY_UPLOAD_BATCH = 200;
export const TOP_UP_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** How many keys to generate and upload given the server-reported unused count. */
export function computeTopUpCount(unused: number): number {
  if (!Number.isFinite(unused) || unused < 0) return 0;
  if (unused >= MIN_UNUSED_ONE_TIME_PREKEYS) return 0;
  return Math.min(TARGET_UNUSED_ONE_TIME_PREKEYS - unused, MAX_ONE_TIME_PREKEY_UPLOAD_BATCH);
}

/** Whether a check is due, given the last check time. */
export function isTopUpCheckDue(lastCheckedAt: number, now: number): boolean {
  return now - lastCheckedAt >= TOP_UP_CHECK_INTERVAL_MS;
}
