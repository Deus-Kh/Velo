/**
 * S03 — 5 messages each direction.
 * Checklist: §4.3.
 * Defect covered: none (baseline).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S03 five messages each direction', () => {
  it('alternating traffic decrypts in order with monotonic counters', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;

    for (let i = 1; i <= 5; i += 1) {
      A!.send('B', 'a' + String(i));
      B!.send('A', 'b' + String(i));
    }

    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(A!.sessionState('B')).toMatchObject({ Ns: 5, Nr: 5 });
    expect(B!.sessionState('A')).toMatchObject({ Ns: 5, Nr: 5 });
    expect(Object.keys(A!.sessionState('B')!.skippedKeys ?? {})).toHaveLength(0);
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {})).toHaveLength(0);
  });
});
