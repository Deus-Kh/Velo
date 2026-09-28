/**
 * S05 — Reorder across a DH ratchet.
 * Checklist: §6.2.
 * Defects covered: P1-3 (skipped keys wiped on a ratchet step) and P1-4
 * (header.pn unused): a message from the previous epoch that arrives
 * after the receiver has already ratcheted to the next one must decrypt
 * from a key drained via pn and kept across the step.
 * Expected before fixes: FAIL. After T2.7 + T2.8: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S05 reorder across a DH ratchet', () => {
  it.fails('an old-epoch message delivered after the next epoch’s message still decrypts', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'a0');
    B!.send('A', 'b0');

    network.hold('B');
    const a1 = A!.send('B', 'a1'); // epoch A1, n = 0
    B!.send('A', 'b1'); // B replies before seeing a1: A ratchets to a new epoch
    const a2 = A!.send('B', 'a2'); // epoch A2, n = 0, pn = 1

    expect(a2.v2.header.dhPub, 'a direction change must start a new epoch (T2.0)').not.toBe(a1.v2.header.dhPub);
    expect(a2.v2.header.pn, 'pn carries the length of the previous sending chain').toBe(1);

    network.reorder('B', 'reverse'); // a2 first, then a1
    const results = network.release('B');
    expect(
      results.map((r) => (r.ok ? 'ok' : r.code)),
      'a1 (previous epoch) must decrypt from the key drained via pn and kept across the ratchet step (P1-3, P1-4)',
    ).toEqual(['ok', 'ok']);
    expect(B!.inbox.map((m) => m.text)).toEqual(['a0', 'a2', 'a1']);
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {}), 'the drained key was consumed').toHaveLength(0);
  });
});
