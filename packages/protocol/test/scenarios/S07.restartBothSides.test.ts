/**
 * S07 — Restart both sides.
 * Checklist: §5.3.
 * Defect covered: none.
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S07 restart both sides', () => {
  it('both clients restart and continue; history reloads from stored keys', () => {
    const w = makeWorld();
    w.clients.A!.send('B', 'one');
    w.clients.B!.send('A', 'two');

    const A2 = w.restart('A');
    const B2 = w.restart('B');

    A2.send('B', 'three');
    B2.send('A', 'four');
    expect(B2.inbox.map((m) => m.text)).toEqual(['three']);
    expect(A2.inbox.map((m) => m.text)).toEqual(['four']);

    // Both sides can still render the whole conversation after the restart.
    expect(A2.loadHistory('B').map((m) => m.text)).toEqual(['one', 'two', 'three', 'four']);
    expect(B2.loadHistory('A').map((m) => m.text)).toEqual(['one', 'two', 'three', 'four']);
  });
});
