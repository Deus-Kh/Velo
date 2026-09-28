/**
 * S27 — Server ordering (T3.2, P2-6, P2-9).
 * Checklist: §9 (storage / ordering).
 * A client's clock must not order the conversation: a peer with a skewed
 * clock (or one that pins itself to the top) is ordered by the server's
 * per-conversation sequence, whether the messages arrive live or are pulled
 * after an offline period.
 * Expected: green from the start (written with T3.2).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S27 server ordering', () => {
  it('a peer with a skewed clock cannot reorder the conversation (live)', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;
    A!.clockSkewMs = -3_600_000; // A stamps every message an hour in the past

    B!.send('A', 'b1');
    A!.send('B', 'a1');
    B!.send('A', 'b2');
    A!.send('B', 'a2');

    const expected = ['b1', 'a1', 'b2', 'a2'];
    expect(B!.storedMessages('A').map((m) => m.text)).toEqual(expected);
    expect(A!.storedMessages('B').map((m) => m.text)).toEqual(expected);
    expect(B!.storedMessages('A').map((m) => m.seq)).toEqual([1, 2, 3, 4]);

    // The clock alone would have put A's messages first: that is the defect the sequence removes.
    const byClock = [...B!.storedMessages('A')].sort((x, y) => x.createdAt - y.createdAt).map((m) => m.text);
    expect(byClock).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('an offline pull is in server order, and the sync cursor is the sequence', () => {
    const { server, network, clients } = makeWorld();
    const { A, B } = clients;
    A!.clockSkewMs = 10 * 365 * 24 * 3_600_000; // A pins itself to the top of everyone's history (P2-9)
    B!.send('A', 'b1');
    network.hold('B');
    A!.send('B', 'a1');
    A!.send('B', 'a2');

    const held = server.undelivered('B', 'A');
    expect(held.map((m) => m.seq)).toEqual([2, 3]);
    expect(held[0]!.createdAt).toBeGreaterThan(Date.now() + 365 * 24 * 3_600_000); // the clock claims the far future

    network.release('B');
    expect(B!.loadHistory('A').map((m) => m.text)).toEqual(['b1', 'a1', 'a2']);
    expect(B!.storedMessages('A').map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(server.heldCiphertextCount('A:B')).toBe(0);
  });

  it('each conversation has its own counter and a resend keeps its sequence', () => {
    const { server, clients } = makeWorld(['A', 'B', 'C']);
    const { A } = clients;
    const ab = A!.send('B', 'to b');
    const ac = A!.send('C', 'to c');
    expect(ab.seq).toBe(1);
    expect(ac.seq).toBe(1);

    const again = server.storeMessage('A', { toUserId: 'B', clientMessageId: ab.clientMessageId, createdAt: 0, protoVersion: 4, v4: ab.v4, initPacket: ab.initPacket });
    expect(again.serverMessageId).toBe(ab.serverMessageId);
    expect(again.seq).toBe(1);
  });
});
