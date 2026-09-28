/**
 * Property: over random interleavings of sends and deliveries, every message
 * decrypts exactly once and nothing throws, as long as no receiver gap
 * exceeds MAX_SKIP. (Cross-epoch reorders become part of this after T2.0;
 * today there are no epochs. The Phase 2 exit gate raises RUNS to 10,000.)
 */
import { describe, expect, it } from 'vitest';
import { MAX_SKIP } from '../../src/ratchet/message';
import { makeWorld, rng } from '../harness';

const RUNS = 300;
const STEPS = 40;

describe('property: random interleavings', () => {
  it('every message decrypts exactly once; no ProtocolError; skipped keys bounded', () => {
    for (let run = 0; run < RUNS; run += 1) {
      const seed = 1000 + run;
      const rand = rng(seed);
      const { network, clients } = makeWorld();
      const { A, B } = clients;
      const sent: Record<string, string[]> = { A: [], B: [] };

      A!.send('B', 'A#0');
      sent.A!.push('A#0');
      network.hold('A');
      network.hold('B');

      for (let step = 0; step < STEPS; step += 1) {
        const r = rand();
        // Keep gaps within MAX_SKIP: force deliveries when a queue is long.
        if (network.pending('B').length > MAX_SKIP - 5) network.releaseOne('B', Math.floor(rand() * 3));
        else if (network.pending('A').length > MAX_SKIP - 5) network.releaseOne('A', Math.floor(rand() * 3));
        else if (r < 0.3) {
          const t = 'A#' + String(sent.A!.length);
          A!.send('B', t);
          sent.A!.push(t);
        } else if (r < 0.6) {
          const t = 'B#' + String(sent.B!.length);
          B!.send('A', t);
          sent.B!.push(t);
        } else if (r < 0.8) network.releaseOne('B', Math.floor(rand() * 5));
        else network.releaseOne('A', Math.floor(rand() * 5));
      }
      network.release('A');
      network.release('B');

      const failures = network.log.filter((l) => !l.ok);
      expect(failures, 'seed ' + String(seed) + ': ' + JSON.stringify(failures.map((f) => (f.ok ? null : f.code)))).toEqual([]);
      expect(B!.inbox.map((m) => m.text).sort(), 'seed ' + String(seed)).toEqual([...sent.A!].sort());
      expect(A!.inbox.map((m) => m.text).sort(), 'seed ' + String(seed)).toEqual([...sent.B!].sort());
      expect(Object.keys(A!.sessionState('B')!.skippedKeys ?? {}).length).toBeLessThanOrEqual(MAX_SKIP);
      expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {}).length).toBeLessThanOrEqual(MAX_SKIP);
    }
  }, 30_000);
});
