/**
 * S11 — Duplicate delivery.
 * Checklist: §6.2.
 * Defect covered: none (a consumed counter is refused).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S11 duplicate delivery', () => {
  it('the second copy is rejected with REPLAY_DETECTED and leaves the session untouched', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'bootstrap');
    network.hold('B');
    A!.send('B', 'once');
    network.duplicate('B', 0);
    const [first, second] = network.release('B');

    expect(first!.ok).toBe(true);
    const afterFirst = B!.sessionState('A');
    expect(second!.ok).toBe(false);
    expect(second!.ok ? null : second!.code).toBe('REPLAY_DETECTED');
    expect(B!.sessionState('A')).toEqual(afterFirst);
    expect(B!.inbox.map((m) => m.text)).toEqual(['bootstrap', 'once']);
  });
});
