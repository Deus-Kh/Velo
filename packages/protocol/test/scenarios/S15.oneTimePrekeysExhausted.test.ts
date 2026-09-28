/**
 * S15 — One-time prekeys exhausted.
 * Checklist: none (server pool behaviour, P0-4).
 * Defect covered: none — the bundle route serves without a one-time prekey
 * when the pool is empty and X3DH degrades to two DHs.
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S15 one-time prekeys exhausted', () => {
  it('the second initiator gets a bundle without a one-time prekey and the session still works', () => {
    const { server, clients } = makeWorld(['A', 'B', 'C'], { oneTimePreKeys: 1 });

    const first = clients.A!.send('B', 'from A');
    expect(first.initPacket!.oneTimePreKeyId).not.toBeNull();
    expect(server.unusedOneTimePreKeyCount('B')).toBe(0);

    const second = clients.C!.send('B', 'from C');
    expect(second.initPacket!.oneTimePreKeyId, 'pool empty: bundle issued without a one-time prekey').toBeNull();

    expect(clients.B!.inbox.map((m) => m.fromUserId + ':' + m.text)).toEqual(['A:from A', 'C:from C']);
    clients.B!.send('C', 'hi C');
    expect(clients.C!.inbox.map((m) => m.text)).toEqual(['hi C']);
  });
});
