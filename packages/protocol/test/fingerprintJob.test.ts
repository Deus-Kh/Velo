import { describe, expect, it } from 'vitest';
import { encodeBase64 } from 'tweetnacl-util';
import { computeSafetyNumber, FINGERPRINT_ITERATIONS, fingerprintHalf, fingerprintHalfJob, safetyNumberJob } from '../src/identity/fingerprint';

/**
 * The resumable fingerprint job (for a phone's UI thread, which drives it
 * in slices) produces the digits of the one-shot function, counts its
 * rounds exactly, and refuses to hand out digits before it is complete.
 */
const bytes = (n: number, seed: number): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

describe('fingerprintHalfJob', () => {
  it('matches fingerprintHalf digit for digit for uneven slices and for odd iteration counts', { timeout: 30_000 }, () => {
    const identifier = bytes(24, 1);
    const identityKey = bytes(64, 2);
    for (const iterations of [1, 7, 99, 100, 101, 250]) {
      const job = fingerprintHalfJob({ identifier, identityKey, iterations });
      expect(job.total).toBe(iterations);
      while (!job.step(30)) {
        /* slices of 30 */
      }
      expect(job.done).toBe(iterations);
      expect(job.digits()).toBe(fingerprintHalf({ identifier, identityKey, iterations }));
    }
    const full = fingerprintHalfJob({ identifier, identityKey });
    expect(full.total).toBe(FINGERPRINT_ITERATIONS);
    while (!full.step(1000)) {
      /* slices of 1000 */
    }
    expect(full.digits()).toBe(fingerprintHalf({ identifier, identityKey }));
  });

  it('counts rounds exactly, never over-steps, and has no digits before completion', () => {
    const job = fingerprintHalfJob({ identifier: bytes(8, 3), identityKey: bytes(64, 4), iterations: 10 });
    expect(job.digits()).toBeNull();
    expect(job.step(4)).toBe(false);
    expect(job.done).toBe(4);
    expect(job.digits()).toBeNull();
    expect(job.step(0)).toBe(false);
    expect(job.step(100)).toBe(true);
    expect(job.done).toBe(10);
    expect(job.step(5)).toBe(true);
    expect(job.done).toBe(10);
    expect(job.digits()).toHaveLength(30);
  });
});

describe('safetyNumberJob', () => {
  it('equals computeSafetyNumber, spans both halves, and spends leftover rounds of a slice on the second half', { timeout: 30_000 }, () => {
    const identity = (seed: number) => ({ identitySignPublicKey: encodeBase64(bytes(32, seed)), identityDhPublicKey: encodeBase64(bytes(32, seed + 1)) });
    const params = { myUserId: 'me', myIdentity: identity(10), theirUserId: 'them', theirIdentity: identity(20) };
    const job = safetyNumberJob(params);
    expect(job.total).toBe(2 * FINGERPRINT_ITERATIONS);
    const seen: number[] = [];
    while (!job.step(1300)) seen.push(job.done);
    seen.push(job.done);
    expect(seen).toEqual([1300, 2600, 3900, 5200, 6500, 7800, 9100, 10400]);
    expect(job.result()).toEqual(computeSafetyNumber(params));
    expect(safetyNumberJob(params).result()).toBeNull();
  });
});
