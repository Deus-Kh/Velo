/**
 * S19 — The ratchet actually advances.
 * Checklist: none (white-box).
 * Defect covered: P1-0 — the DH ratchet never executed: both sides kept
 * the DHs generated at session creation and the root key was never
 * re-derived, so the protocol degraded to two static hash chains with no
 * post-compromise security.
 * Expected before fixes: FAIL. After T2.0: pass. (Flipped green by T2.0.)
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S19 ratchet advances', () => {
  it('after A→B→A→B each side rotated DHs at least twice and the root key left the X3DH value', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;
    const dhsA = new Set<string>();
    const dhsB = new Set<string>();
    const rootsA = new Set<string>();
    const rootsB = new Set<string>();
    const record = () => {
      dhsA.add(A!.sessionState('B')!.DHsPublicKey);
      dhsB.add(B!.sessionState('A')!.DHsPublicKey);
      rootsA.add(A!.sessionState('B')!.rootKey);
      rootsB.add(B!.sessionState('A')!.rootKey);
    };

    // B's first ratchet key is its signed prekey, replaced inside the first receive.
    dhsB.add(B!.store.getJson<{ current: { publicKey: string } }>('signed-prekeys')!.current.publicKey);

    A!.send('B', 'a1');
    record();
    B!.send('A', 'b1');
    record();
    A!.send('B', 'a2');
    record();
    B!.send('A', 'b2');
    record();

    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2']);

    expect(dhsA.size, 'A never rotated its DH key across direction changes (P1-0)').toBeGreaterThanOrEqual(3);
    expect(dhsB.size, 'B never rotated its DH key across direction changes (P1-0)').toBeGreaterThanOrEqual(3);
    expect(rootsA.size, 'root key never re-derived on A: KDF_RK did not run').toBeGreaterThanOrEqual(3);
    // B's X3DH root is replaced inside its first receive, so one fewer is observable.
    expect(rootsB.size, 'root key never re-derived on B: KDF_RK did not run').toBeGreaterThanOrEqual(2);
  });
});
