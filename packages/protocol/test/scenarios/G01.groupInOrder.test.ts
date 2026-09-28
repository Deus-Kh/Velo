/**
 * G01 — Three-member group, messages in order (T6.1–T6.4).
 * Spec §7b T6.6. Creation distributes every member's sender key to every
 * other member over the pairwise sessions; each message is encrypted once
 * under the sender's chain and signed; the server holds one copy per
 * recipient until that recipient acks; a restart keeps the keys.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('G01 group in order', () => {
  it('every member reads every message in server order; the server keeps no delivered ciphertext', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C'], 'trio');

    // Creation: each member holds the two others' keys, obtained over pairwise sessions (control content, never text).
    for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'A'], ['B', 'C'], ['C', 'A'], ['C', 'B']] as const) {
      expect(clients[y]!.peerSenderKey(g, x)?.keyId, `${y} holds ${x}'s key`).toBe(clients[x]!.ownSenderKey(g)!.keyId);
      expect(clients[y]!.peerSenderKey(g, x)?.signingPrivateKey, 'a distribution carries no signing secret').toBeUndefined();
    }
    expect(A!.inbox).toEqual([]);
    expect(A!.controlInbox.map((c) => [c.fromUserId, c.content.kind])).toEqual([['B', 'skdm'], ['C', 'skdm']]);

    A!.sendGroup(g, 'a1');
    A!.sendGroup(g, 'a2');
    B!.sendGroup(g, 'b1');
    C!.sendGroup(g, 'c1');

    expect(network.log.every((r) => r.ok)).toBe(true);
    for (const c of [A!, B!, C!]) expect(c.groupMessages(g)).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(C!.groupInbox.map((m) => [m.fromUserId, m.text])).toEqual([['A', 'a1'], ['A', 'a2'], ['B', 'b1']]);
    expect(B!.peerSenderKey(g, 'A')!.iteration).toBe(2); // the receiver's copy of A's chain advanced
    expect(A!.ownSenderKey(g)!.iteration).toBe(2);

    // T3.1 for groups: every copy was acked and deleted; receipts remain.
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);
    expect(server.receipts.filter((r) => r.conversationId === 'group:' + g)).toHaveLength(8);

    // The wire carried only ciphertext.
    const wire = JSON.stringify(network.log.map((r) => r.dto));
    for (const text of ['a1', 'a2', 'b1', 'c1']) expect(wire).not.toContain('"' + text + '"');
  });

  it('a restart keeps the sender keys and the local messages; the next message opens', { timeout: 30_000 }, () => {
    const { clients, restart } = makeWorld(['A', 'B', 'C']);
    const { A } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'before restart');
    const C2 = restart('C');
    expect(C2.groupMessages(g)).toEqual(['before restart']);
    expect(C2.peerSenderKey(g, 'A')!.iteration).toBe(1);
    A!.sendGroup(g, 'after restart');
    C2.sendGroup(g, 'from the restarted device');
    expect(C2.groupMessages(g)).toEqual(['before restart', 'after restart', 'from the restarted device']);
    expect(clients.B!.groupMessages(g)).toEqual(['before restart', 'after restart', 'from the restarted device']);
  });
});
