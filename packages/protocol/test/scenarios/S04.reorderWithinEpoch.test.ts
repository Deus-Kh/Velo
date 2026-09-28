/**
 * S04 — Reorder within an epoch.
 * Checklist: §6.2 (out-of-order delivery).
 * Defect covered: none (skipped-key handling on one chain works today).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S04 reorder within an epoch', () => {
  it('five messages delivered in reverse all decrypt and the skipped keys are consumed', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'a0'); // bootstrap delivered normally
    network.hold('B');
    for (let i = 1; i <= 5; i += 1) A!.send('B', 'a' + String(i));
    network.reorder('B', 'reverse');
    const results = network.release('B');

    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true]);
    expect(B!.inbox.map((m) => m.text)).toEqual(['a0', 'a5', 'a4', 'a3', 'a2', 'a1']);
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {}), 'every skipped key was used exactly once').toHaveLength(0);
    expect(B!.sessionState('A')!.Nr).toBe(6);
  });
});
