/**
 * S29 — Message actions and the timer over the sessions (T7.1–T7.3, T7.7).
 * Spec §7c T7.9. A reaction, an edit, a delete request, a timer and a
 * profile travel as content inside the pairwise ratchet and the group
 * chain: authenticated like text, opaque to the server, acked and deleted
 * like any copy, never shown as a message. The receiver's store layer
 * applies them (app code, Jest-tested); here the wire and the session are
 * what is under test.
 * Expected: green from the start (written with T7.9).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S29 actions and timer over the sessions', () => {
  it('pairwise: every action kind reaches the peer decoded and authenticated, is acked, and never enters the text inbox', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'hello');
    const target = { senderUserId: 'A', clientMessageId: 'c-hello' };
    const before = B!.inbox.length;

    A!.sendContent('B', { v: 1, kind: 'reaction', target, emoji: '\u{1F44D}' });
    A!.sendContent('B', { v: 1, kind: 'edit', target, text: 'hello, edited' });
    A!.sendContent('B', { v: 1, kind: 'timer', seconds: 3600 });
    A!.sendContent('B', { v: 1, kind: 'profile', name: 'Alice', avatar: { kind: 'emoji', emoji: '\u{1F98A}', color: '#ffaa00' }, updatedAt: 42 });
    A!.sendContent('B', { v: 1, kind: 'delete', target });

    expect(network.log.slice(-5).every((r) => r.ok)).toBe(true);
    expect(B!.actionInbox.map((a) => [a.fromUserId, a.content.kind])).toEqual([
      ['A', 'reaction'],
      ['A', 'edit'],
      ['A', 'timer'],
      ['A', 'profile'],
      ['A', 'delete'],
    ]);
    expect(B!.actionInbox[1]!.content).toEqual({ v: 1, kind: 'edit', target, text: 'hello, edited' });
    expect(B!.actionInbox[3]!.content).toMatchObject({ kind: 'profile', name: 'Alice', updatedAt: 42 });
    expect(B!.inbox).toHaveLength(before); // nothing shown as a message
    expect(B!.controlInbox).toEqual([]); // not sender-key traffic either
    expect(server.heldCiphertextCount('A:B')).toBe(0); // acked and deleted like text (T3.1)
    // The wire carried nothing readable.
    const wire = JSON.stringify(network.log.slice(-5).map((r) => r.dto));
    for (const s of ['reaction', 'edited', 'Alice', '3600']) expect(wire).not.toContain(s);

    // The session kept ratcheting: B replies, A reads it.
    B!.send('A', 'seen');
    expect(A!.inbox.map((m) => m.text)).toEqual(['seen']);
  });

  it('group chain: an action reaches every member on the sender chain, acked per copy, never as a message', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'group hello');
    const target = { senderUserId: 'A', clientMessageId: 'c-group-hello' };

    const res = A!.sendGroupContent(g, { v: 1, kind: 'reaction', target, emoji: '❤' });
    expect(res.ok).toBe(true);
    expect(network.log.slice(-2).every((r) => r.ok)).toBe(true);
    for (const m of [B!, C!]) {
      expect(m.actionInbox.map((a) => [a.fromUserId, a.groupId, a.content.kind])).toEqual([['A', g, 'reaction']]);
      expect(m.groupMessages(g)).toEqual(['group hello']);
    }
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);

    // Out of order with text on the same chain: the skipped-key path covers actions too.
    network.hold('C');
    A!.sendGroup(g, 'after');
    A!.sendGroupContent(g, { v: 1, kind: 'timer', seconds: 60 });
    network.reorder('C', 'reverse');
    const results = network.release('C');
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(C!.actionInbox.map((a) => a.content.kind)).toEqual(['reaction', 'timer']);
    expect(C!.groupMessages(g)).toEqual(['group hello', 'after']);
    expect(C!.peerSenderKey(g, 'A')!.iteration).toBe(4); // hello, reaction, after, timer: one chain step each
  });
});
