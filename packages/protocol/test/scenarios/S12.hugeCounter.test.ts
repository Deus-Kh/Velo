/**
 * S12 — header.n = 10_000_000.
 * Checklist: none (adversarial input).
 * Defect covered: unbounded skip loop (P1-6, T2.6): a forged counter makes
 * the receiver derive ten million keys before it can fail.
 * Expected before fixes: FAIL — the child process is killed at the 5 s
 * deadline instead of returning TOO_MANY_SKIPPED. After T2.6: pass.
 * (Flipped green by T2.6: the gap is refused before any derivation.)
 *
 * The ratchet runs in a child process because a synchronous hang cannot be
 * interrupted from inside the test worker.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const CHILD = join(__dirname, '..', 'harness', 's12-child.cjs');

type Outcome = { outcome: 'decrypted' | 'threw'; code?: string | null; ms: number };

function runChild(n: number, timeoutMs: number): Outcome | 'TIMEOUT' {
  try {
    const out = execFileSync(process.execPath, [CHILD, String(n)], { timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out) as Outcome;
  } catch (e) {
    const err = e as { signal?: string; killed?: boolean; stderr?: string };
    if (err.killed || err.signal === 'SIGTERM') return 'TIMEOUT';
    throw new Error('child failed: ' + String(err.stderr ?? e));
  }
}

describe('S12 header.n = 10_000_000', () => {
  it('control: a gap within the per-step bound is derived and fails only on authentication', { timeout: 30_000 }, () => {
    const r = runChild(99, 20_000);
    expect(r).not.toBe('TIMEOUT');
    expect((r as Outcome).outcome).toBe('threw'); // DECRYPT_FAILED: the forged message has no valid ciphertext at n=99
    expect((r as Outcome).code).toBe('DECRYPT_FAILED');
  });

  it('a forged counter of 10_000_000 is refused with TOO_MANY_SKIPPED in under 50 ms', { timeout: 30_000 }, () => {
    const r = runChild(10_000_000, 30_000);
    expect(r, 'ratchetDecrypt did not return within 30 s for header.n = 10_000_000').not.toBe('TIMEOUT');
    expect((r as Outcome).outcome).toBe('threw');
    expect((r as Outcome).code).toBe('TOO_MANY_SKIPPED');
    expect((r as Outcome).ms).toBeLessThan(50);
  }, 15_000);
});
