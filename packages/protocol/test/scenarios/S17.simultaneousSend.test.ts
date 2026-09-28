/**
 * S17 — Simultaneous send (ratchet race).
 * Checklist: none.
 * Defect covered: none today, precisely because nothing ratchets: both
 * sides adopt the other's static key. After T2.0 both sides ratchet on the
 * crossing messages and this scenario becomes the real race test; it must
 * keep passing.
 * Expected before fixes: pass (verify). After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S17 simultaneous send', () => {
  it('A and B each send before receiving; both decrypt and the conversation continues', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    // Both sides need a session first: A bootstraps, B replies once.
    A!.send('B', 'bootstrap');
    B!.send('A', 'ack');

    network.hold('A');
    network.hold('B');
    A!.send('B', 'crossing from A');
    B!.send('A', 'crossing from B');
    const toA = network.release('A');
    const toB = network.release('B');

    expect(toA.map((r) => r.ok)).toEqual([true]);
    expect(toB.map((r) => r.ok)).toEqual([true]);

    A!.send('B', 'after race');
    B!.send('A', 'after race too');
    expect(B!.inbox.map((m) => m.text)).toEqual(['bootstrap', 'crossing from A', 'after race']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['ack', 'crossing from B', 'after race too']);
  });
});
