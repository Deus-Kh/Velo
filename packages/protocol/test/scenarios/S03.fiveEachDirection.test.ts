/**
 * S03 — 5 messages each direction.
 * Checklist: §4.3.
 * Defect covered: none (baseline).
 * Expected before fixes: pass. After: pass (counters now reset per epoch
 * because every direction change performs a ratchet step, T2.0).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S03 five messages each direction', () => {
  it('alternating traffic decrypts in order; every direction change is one ratchet step', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;
    const rootsA = new Set<string>();
    const rootsB = new Set<string>();

    for (let i = 1; i <= 5; i += 1) {
      A!.send('B', 'a' + String(i));
      rootsB.add(B!.sessionState('A')!.rootKey);
      B!.send('A', 'b' + String(i));
      rootsA.add(A!.sessionState('B')!.rootKey);
    }

    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);

    // Ten direction changes: five ratchet steps per side, each with a new root key.
    expect(rootsA.size).toBe(5);
    expect(rootsB.size).toBe(5);
    // Per-epoch counters: one message per epoch in this pattern.
    expect(A!.sessionState('B')).toMatchObject({ Ns: 0, Nr: 1, PN: 1 });
    expect(B!.sessionState('A')).toMatchObject({ Ns: 1, Nr: 1, PN: 1 });
    expect(Object.keys(A!.sessionState('B')!.skippedKeys ?? {})).toHaveLength(0);
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {})).toHaveLength(0);
  });
});
