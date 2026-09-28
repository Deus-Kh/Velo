/**
 * S05 — Reorder across a DH ratchet.
 * Checklist: §6.2.
 * Defects covered: P1-3 (skipped keys wiped on a ratchet step) and P1-4
 * (header.pn unused). A sends two messages in one epoch; B receives the
 * first and replies, so A ratchets and sends in the next epoch; the
 * second message of the old epoch arrives after the new epoch's message
 * and must decrypt from a key drained via pn and kept across the step.
 * Expected before fixes: FAIL. After T2.7 + T2.8: pass. (Flipped green by T2.8.)
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S05 reorder across a DH ratchet', () => {
  it('an old-epoch message delivered after the next epoch’s message still decrypts', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'a0');
    B!.send('A', 'b0'); // A ratchets: epoch A1

    network.hold('B');
    const a1 = A!.send('B', 'a1'); // epoch A1, n = 0
    const a1b = A!.send('B', 'a1b'); // epoch A1, n = 1 — will arrive last
    network.releaseOne('B', 0); // B gets a1, ratchets, replies with a new key
    B!.send('A', 'b1'); // A ratchets: epoch A2
    const a2 = A!.send('B', 'a2'); // epoch A2, n = 0, pn = 2

    const h = (dto: typeof a1) => A!.sentHeader(dto.clientMessageId); // T3.6: headers are encrypted on the wire
    expect(h(a2).dhPub, 'a direction change must start a new epoch (T2.0)').not.toBe(h(a1).dhPub);
    expect(h(a1b).dhPub).toBe(h(a1).dhPub);
    expect(h(a2).pn, 'pn carries the length of the previous sending chain').toBe(2);

    network.reorder('B', 'reverse'); // a2 first, then a1b
    const results = network.release('B');
    expect(
      results.map((r) => (r.ok ? 'ok' : r.code)),
      'a1b (previous epoch) must decrypt from the key drained via pn and kept across the ratchet step (P1-3, P1-4)',
    ).toEqual(['ok', 'ok']);
    expect(B!.inbox.map((m) => m.text)).toEqual(['a0', 'a1', 'a2', 'a1b']);
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {}), 'the drained key was consumed').toHaveLength(0);
  });
});
