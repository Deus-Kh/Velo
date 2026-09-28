/**
 * S05 — Reorder across a DH ratchet.
 * Checklist: §6.2.
 * Defects covered: P1-0 (no ratchet step ever happens), P1-3 (skipped keys
 * wiped on a ratchet step), P1-4 (header.pn unused).
 * Expected before fixes: FAIL — the precondition "a direction change
 * started a new epoch" does not hold, because the DH ratchet never runs.
 * After T2.0/T2.7/T2.8: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S05 reorder across a DH ratchet', () => {
  it.fails('a2/a3 (after B replied) are in a new epoch and still decrypt when delivered before a1', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    const a1 = A!.send('B', 'a1');
    B!.send('A', 'b1'); // direction change: A must ratchet before its next send

    network.hold('B');
    const a2 = A!.send('B', 'a2');
    const a3 = A!.send('B', 'a3');

    expect(
      a2.v2.header.dhPub,
      'no DH ratchet step happened between a1 and a2 although the direction changed (P1-0, T2.0)',
    ).not.toBe(a1.v2.header.dhPub);
    expect(a2.v2.header.pn, 'pn must carry the previous chain length (T2.8)').toBe(1);

    network.reorder('B', 'reverse');
    const results = network.release('B');
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a3', 'a2']);
    expect(a3.v2.header.dhPub).toBe(a2.v2.header.dhPub);
  });
});
