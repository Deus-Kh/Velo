/**
 * S19 — The ratchet actually advances.
 * Checklist: none (white-box).
 * Defect covered: P1-0 — the DH ratchet never executes: both sides keep the
 * DHs generated at session creation and the root key is never re-derived,
 * so the protocol degrades to two static hash chains with no
 * post-compromise security.
 * Expected before fixes: FAIL. After T2.0: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S19 ratchet advances', () => {
  it.fails('after A→B→A→B each side rotated DHs at least twice and the root key left the X3DH value', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'a1');
    const rootA0 = A!.sessionState('B')!.rootKey;
    const rootB0 = B!.sessionState('A')!.rootKey;
    const dhsA: string[] = [A!.sessionState('B')!.DHsPublicKey!];
    const dhsB: string[] = [B!.sessionState('A')!.DHsPublicKey!];

    B!.send('A', 'b1');
    dhsB.push(B!.sessionState('A')!.DHsPublicKey!);
    A!.send('B', 'a2');
    dhsA.push(A!.sessionState('B')!.DHsPublicKey!);
    B!.send('A', 'b2');
    dhsB.push(B!.sessionState('A')!.DHsPublicKey!);
    A!.send('B', 'a3');
    dhsA.push(A!.sessionState('B')!.DHsPublicKey!);

    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2']);

    expect(new Set(dhsA).size, 'A never rotated its DH key across direction changes (P1-0)').toBeGreaterThanOrEqual(3);
    expect(new Set(dhsB).size, 'B never rotated its DH key across direction changes (P1-0)').toBeGreaterThanOrEqual(3);
    expect(A!.sessionState('B')!.rootKey, 'root key is still the X3DH output: KDF_RK never ran on A').not.toBe(rootA0);
    expect(B!.sessionState('A')!.rootKey, 'root key is still the X3DH output: KDF_RK never ran on B').not.toBe(rootB0);
  });
});
