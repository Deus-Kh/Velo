/**
 * G05 — Removed member cannot read after rotation (T6.5).
 * Spec §7b T6.6. Removing C rotates A's and B's keys and distributes them
 * to the remaining members only; C's device wipes the group's keys; the
 * server sends C nothing and refuses its sends. A C that kept a copy of
 * its pre-removal state, and obtains a copy off the wire, still cannot
 * open it: the key is stale and its request for the new key is ignored.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { groupDecrypt } from '../../src/senderkey/message';
import { VirtualClient, codeOf, makeWorld } from '../harness';

describe('G05 group removed member', () => {
  it('after removal the departed member holds nothing usable and receives nothing; the rest continue', { timeout: 30_000 }, () => {
    const { server, network, clients, clock } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'all three');
    expect(C!.groupMessages(g)).toEqual(['all three']);

    const snapshot = C!.serialize(); // an attacker who kept the device state from before the removal
    const bKeyBefore = B!.ownSenderKey(g)!.keyId;
    const aKeyBefore = A!.ownSenderKey(g)!.keyId;

    A!.removeMember(g, 'C');

    // C: everything for the group is gone; the server no longer answers for it.
    expect(server.getGroup('C', g)).toBeNull();
    expect(C!.ownSenderKey(g)).toBeNull();
    expect(C!.peerSenderKey(g, 'A')).toBeNull();
    expect(C!.peerSenderKey(g, 'B')).toBeNull();
    expect(C!.store.keys('sk-')).toEqual([]);

    // A and B rotated and told only each other.
    expect(A!.ownSenderKey(g)!.keyId).not.toBe(aKeyBefore);
    expect(B!.ownSenderKey(g)!.keyId).not.toBe(bKeyBefore);
    expect(A!.distributionsSent.filter((d) => d.keyId === A!.ownSenderKey(g)!.keyId).map((d) => d.to)).toEqual(['B']);
    expect(B!.distributionsSent.filter((d) => d.keyId === B!.ownSenderKey(g)!.keyId).map((d) => d.to)).toEqual(['A']);
    expect(A!.peerSenderKey(g, 'C')).toBeNull(); // C's key is forgotten by the others too
    expect(B!.peerSenderKey(g, 'C')).toBeNull();

    // B sends: one copy, for A. C gets nothing and cannot send.
    const res = B!.sendGroup(g, 'after C was removed');
    expect(res.ok && res.copies.map((c) => c.toUserId)).toEqual(['A']);
    expect(A!.groupMessages(g)).toEqual(['all three', 'after C was removed']);
    expect(C!.groupMessages(g)).toEqual(['all three']);
    expect(() => C!.sendGroup(g, 'still here?')).toThrow();
    expect(server.groupSend('C', { groupId: g, clientMessageId: 'x', createdAt: 1, epoch: 2, g1: (res.ok ? res.copies[0]!.g1 : null)! })).toEqual({ ok: false, code: 'FORBIDDEN' });

    // Even with A's copy in hand (a compromised server or the wire), the wiped C cannot open it and asks nobody.
    const copyForA = res.ok ? res.copies[0]! : null!;
    expect(codeOf(() => C!.receiveGroup({ ...copyForA, toUserId: 'C' }))).toBe('SENDER_KEY_MISSING');
    expect(C!.keyRequestsSent).toEqual([]);

    // The C that kept its old state: the honest client refuses (not a member); the primitive itself finds B's new keyId stale.
    const Cold = VirtualClient.restore('C', server, snapshot, clock.now);
    network.attach(Cold);
    const deadKey = Cold.peerSenderKey(g, 'B')!;
    expect(deadKey.keyId).toBe(bKeyBefore);
    expect(codeOf(() => Cold.receiveGroup({ ...copyForA, toUserId: 'C' }))).toBe('SENDER_KEY_MISSING');
    expect(codeOf(() => groupDecrypt(deadKey, copyForA.g1, { groupId: g, senderUserId: 'B' }))).toBe('SENDER_KEY_STALE');
    // Asking B for the new key over the still-valid pairwise session is ignored: B checks membership before answering.
    Cold.sendContent('B', { v: 1, kind: 'skdm-request', groupId: g });
    expect(B!.controlInbox.at(-1)).toMatchObject({ fromUserId: 'C', content: { kind: 'skdm-request', groupId: g } });
    expect(B!.distributionsSent.filter((d) => d.to === 'C' && d.keyId === B!.ownSenderKey(g)!.keyId)).toEqual([]);
    expect(Cold.peerSenderKey(g, 'B')!.keyId).toBe(bKeyBefore); // still the dead key
    expect(Cold.groupMessages(g)).toEqual(['all three']);
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);
  });

  it('leaving is the same rotation, and a member removed while offline finds no keys and no copies on return', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'm1');

    network.hold('C'); // C is offline: pairwise traffic to it queues; the group:changed notice reaches it on reconnect (modelled as immediate)
    const aKeyBefore = A!.ownSenderKey(g)!.keyId;
    B!.leaveGroup(g);
    expect(server.getGroup('B', g)).toBeNull();
    expect(B!.store.keys('sk-')).toEqual([]);
    expect(A!.ownSenderKey(g)!.keyId).not.toBe(aKeyBefore);
    A!.sendGroup(g, 'm2 after B left');
    expect(B!.groupMessages(g)).toEqual(['m1']);

    // C comes back: A's new key was waiting in the pairwise queue, ahead of the group copy.
    const results = network.release('C');
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(C!.groupMessages(g)).toEqual(['m1', 'm2 after B left']);
    expect(C!.peerSenderKey(g, 'B')).toBeNull();
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);
  });
});
