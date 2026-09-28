/**
 * G06 — Rotation redistributes to everyone (T6.5).
 * Spec §7b T6.6. Every membership change gives every remaining member a
 * fresh keyId, held by every other remaining member and by nobody else;
 * messages flow in every direction after each change; a send under an
 * old epoch is refused by the server; nothing is held after delivery.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { groupEncrypt } from '../../src/senderkey/message';
import { makeWorld } from '../harness';

describe('G06 group rotation redistributes', () => {
  it('add then leave: keys rotate for the remaining members only and every direction keeps working', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C', 'D']);
    const { A, B, C, D } = clients;
    const g = A!.createGroup(['B', 'C']);
    const keyIds = (ids: string[]) => Object.fromEntries(ids.map((x) => [x, clients[x]!.ownSenderKey(g)!.keyId]));
    const everyoneHoldsEveryone = (ids: string[]) => {
      for (const x of ids) for (const y of ids) if (x !== y) expect(clients[y]!.peerSenderKey(g, x)?.keyId, `${y} holds ${x}`).toBe(clients[x]!.ownSenderKey(g)!.keyId);
    };
    const allSendAllRead = (ids: string[], tag: string) => {
      const before = Object.fromEntries(ids.map((y) => [y, clients[y]!.groupMessages(g).length]));
      for (const x of ids) clients[x]!.sendGroup(g, `${tag} from ${x}`);
      for (const y of ids) expect(clients[y]!.groupMessages(g).slice(before[y]), `${y} reads ${tag}`).toEqual(ids.map((x) => `${tag} from ${x}`));
    };

    const e1 = keyIds(['A', 'B', 'C']);
    everyoneHoldsEveryone(['A', 'B', 'C']);
    allSendAllRead(['A', 'B', 'C'], 'e1');

    A!.addMembers(g, ['D']);
    const e2 = keyIds(['A', 'B', 'C', 'D']);
    for (const x of ['A', 'B', 'C']) expect(e2[x]).not.toBe(e1[x]);
    everyoneHoldsEveryone(['A', 'B', 'C', 'D']);
    allSendAllRead(['A', 'B', 'C', 'D'], 'e2');
    expect(D!.groupMessages(g)).toEqual(['e2 from A', 'e2 from B', 'e2 from C', 'e2 from D']); // nothing from e1

    B!.leaveGroup(g);
    const e3 = keyIds(['A', 'C', 'D']);
    for (const x of ['A', 'C', 'D']) expect(e3[x]).not.toBe(e2[x]);
    everyoneHoldsEveryone(['A', 'C', 'D']);
    for (const x of ['A', 'C', 'D']) {
      // The e3 key went to the remaining members only; B never received it.
      expect(clients[x]!.distributionsSent.filter((d) => d.keyId === e3[x]).map((d) => d.to).sort()).toEqual(['A', 'C', 'D'].filter((y) => y !== x));
      expect(clients[x]!.peerSenderKey(g, 'B')).toBeNull();
    }
    expect(B!.store.keys('sk-')).toEqual([]);
    allSendAllRead(['A', 'C', 'D'], 'e3');
    expect(B!.groupMessages(g).filter((t) => t.startsWith('e3'))).toEqual([]);

    // The server's epoch is authoritative: a send stamped with the previous epoch is refused, nothing is fanned out.
    const stale = groupEncrypt(A!.ownSenderKey(g)!, 'stale', { groupId: g, senderUserId: 'A' });
    const logBefore = network.log.length;
    expect(network.sendGroup('A', { groupId: g, clientMessageId: 'stale', createdAt: 1, epoch: 2, g1: stale.message })).toEqual({ ok: false, code: 'STALE_EPOCH', epoch: 3 });
    expect(network.log).toHaveLength(logBefore);

    expect(network.log.every((r) => r.ok)).toBe(true);
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);
  });

  it('a rotation while a member is offline reaches it on reconnect before the messages that need it', { timeout: 30_000 }, () => {
    const { network, clients } = makeWorld(['A', 'B', 'C', 'D']);
    const { A, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    network.hold('C');
    A!.addMembers(g, ['D']); // A, B and D distribute new keys to C over pairwise sessions: queued
    A!.sendGroup(g, 'needs the e2 key');
    const pending = network.pending('C');
    expect(pending.filter((p) => 'g1' in p)).toHaveLength(1);
    expect(pending.filter((p) => !('g1' in p)).length).toBeGreaterThanOrEqual(3); // three distributions (A, B, D)
    const results = network.release('C');
    expect(results.every((r) => r.ok)).toBe(true);
    expect(C!.groupMessages(g)).toEqual(['needs the e2 key']);
    expect(C!.keyRequestsSent).toEqual([]);
  });
});
