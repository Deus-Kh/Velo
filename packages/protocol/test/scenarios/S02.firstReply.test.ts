/**
 * S02 — First reply.
 * Checklist: §4.2.
 * Defect covered: none (baseline).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S02 first reply', () => {
  it('B replies over the session bootstrapped from the initPacket; no second bootstrap', () => {
    const { server, clients } = makeWorld();
    const { A, B } = clients;

    A!.send('B', 'hello');
    const reply = B!.send('A', 'hi back');

    expect(A!.inbox.map((m) => m.text)).toEqual(['hi back']);
    expect(reply.initPacket, 'a reply over an existing session carries no initPacket').toBeNull();
    expect(server.bundleIssues, 'the responder never fetches a bundle').toHaveLength(1);

    // A now knows B's sending key.
    expect(A!.sessionState('B')!.DHrPublicKey).toBe(B!.sessionState('A')!.DHsPublicKey);
    expect(A!.sessionState('B')!.Nr).toBe(1);
  });
});
