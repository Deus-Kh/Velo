/**
 * S08 — Receiver offline for the first message.
 * Checklist: §6.1.
 * Defect covered: none (initPacket rides with the first message; the
 * receiver bootstraps from it and decrypts the rest in order).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S08 receiver offline for the first message', () => {
  it('B comes online after three messages and bootstraps from the first', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    network.hold('B');
    const first = A!.send('B', 'm1');
    const later = A!.send('B', 'm2');
    A!.send('B', 'm3');
    expect(first.initPacket).not.toBeNull();
    expect(later.initPacket, 'later messages carry no initPacket (synthesis removed, T2.13)').toBeNull();

    const results = network.release('B');
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(B!.inbox.map((m) => m.text)).toEqual(['m1', 'm2', 'm3']);
  });
});
