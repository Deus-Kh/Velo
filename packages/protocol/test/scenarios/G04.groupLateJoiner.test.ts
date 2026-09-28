/**
 * G04 — Late joiner (T6.4 distribution, T6.5 rotation on add).
 * Spec §7b T6.6. A member added later gets every member's fresh key for
 * the new epoch and reads from there on; nothing from before is held for
 * it. A member that lost a sender's state gets a re-distribution at the
 * sender's *current* iteration and cannot open what was sent in between.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { codeOf, makeWorld } from '../harness';

describe('G04 group late joiner', () => {
  it('the new member starts at the new epoch: fresh keys from everyone, nothing from before', { timeout: 30_000 }, () => {
    const { server, clients } = makeWorld(['A', 'B', 'C', 'D']);
    const { A, B, C, D } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'before D 1');
    B!.sendGroup(g, 'before D 2');
    const before = { A: A!.ownSenderKey(g)!.keyId, B: B!.ownSenderKey(g)!.keyId, C: C!.ownSenderKey(g)!.keyId };

    A!.addMembers(g, ['D']);
    expect(server.getGroup('D', g)!.epoch).toBe(2);
    for (const x of ['A', 'B', 'C'] as const) {
      expect(clients[x]!.ownSenderKey(g)!.keyId, `${x} rotated`).not.toBe(before[x]);
      expect(clients[x]!.ownSenderKey(g)!.iteration).toBe(0);
      expect(D!.peerSenderKey(g, x)?.keyId, `D holds ${x}'s new key`).toBe(clients[x]!.ownSenderKey(g)!.keyId);
      expect(D!.peerSenderKey(g, x)!.iteration).toBe(0);
      expect(clients[x]!.peerSenderKey(g, 'D')?.keyId, `${x} holds D's key`).toBe(D!.ownSenderKey(g)!.keyId);
    }
    expect(server.undeliveredGroup('D', g)).toEqual([]); // no copies of the past exist for D
    expect(D!.groupMessages(g)).toEqual([]);

    A!.sendGroup(g, 'after D');
    D!.sendGroup(g, 'hello from D');
    expect(D!.groupMessages(g)).toEqual(['after D', 'hello from D']);
    expect(C!.groupMessages(g)).toEqual(['before D 1', 'before D 2', 'after D', 'hello from D']);
  });

  it('a re-distribution starts at the sender’s current iteration: what was sent while the state was missing stays closed', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'i0');
    A!.sendGroup(g, 'i1');

    C!.store.delete('sk-peer:' + g + ':A'); // C lost A's state (a partial restore)
    network.hold('C');
    A!.sendGroup(g, 'i2 while C is keyless');
    const [r] = network.release('C');
    expect(r && !r.ok ? r.code : null).toBe('SENDER_KEY_MISSING');
    expect(C!.keyRequestsSent).toEqual([{ to: 'A', groupId: g }]);
    // A answered over the pairwise session with its state as it is now: iteration 3.
    expect(C!.peerSenderKey(g, 'A')!.keyId).toBe(A!.ownSenderKey(g)!.keyId);
    expect(C!.peerSenderKey(g, 'A')!.iteration).toBe(3);

    // The copy waits on the server, but a state that starts at 3 cannot derive key 2.
    const waiting = server.undeliveredGroup('C', g);
    expect(waiting.map((c) => c.g1.iteration)).toEqual([2]);
    expect(codeOf(() => C!.receiveGroup(waiting[0]!))).toBe('UNKNOWN_OLD_MESSAGE');
    expect(C!.loadGroupHistory(g).map((m) => m.text)).toEqual(['i0', 'i1']);
    expect(server.undeliveredGroup('C', g)).toHaveLength(1);

    // From here on everything opens.
    A!.sendGroup(g, 'i3 after re-key');
    expect(C!.groupMessages(g)).toEqual(['i0', 'i1', 'i3 after re-key']);
  });
});
