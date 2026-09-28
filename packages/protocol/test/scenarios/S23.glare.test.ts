/**
 * S23 — Glare: both sides bootstrap at once (T2.11, P1-11).
 * Checklist: none (added with T2.11).
 * Defect covered: two sessions created concurrently could never converge;
 * every message failed on the other side and only a manual reset helped.
 * Expected: the lower user id's session wins; the winner keeps its own
 * session and decrypts the loser's in-flight messages through a secondary
 * session; the loser adopts the winner's session; after the loser has
 * switched, the secondary is retired and the conversation continues on
 * one session in both directions. No manual reset.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S23 glare', () => {
  it('converges on the lower user id’s session without losing the loser’s in-flight messages', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients; // 'A' < 'B': A wins

    network.hold('A');
    network.hold('B');
    const a1 = A!.send('B', 'a1'); // A bootstraps: packet + message
    const b1 = B!.send('A', 'b1'); // B bootstraps too
    const b2 = B!.send('A', 'b2'); // B keeps sending on its own session
    expect(a1.initPacket).not.toBeNull();
    expect(b1.initPacket).not.toBeNull();
    expect(b2.initPacket).toBeNull();
    const ownA = A!.sessionState('B')!.DHsPublicKey;

    // A (winner) receives B's packet and messages: keeps its session, decrypts through a secondary.
    const toA = network.release('A');
    expect(toA.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok', 'ok']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2']);
    expect(A!.sessionState('B')!.DHsPublicKey, 'the winner keeps its own session').toBe(ownA);
    expect(A!.store.has('session-secondary:B'), 'the loser’s session is kept as a decrypt-only secondary').toBe(true);

    // B (loser) receives A's packet: adopts A's session, drops its own.
    const toB = network.release('B');
    expect(toB.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok']);
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1']);
    expect(B!.sessionState('A')!.DHrPublicKey).toBe(A!.sentHeader(a1.clientMessageId).dhPub);

    // From here on, one session: B's reply decrypts on A's primary and retires the secondary.
    B!.send('A', 'b3');
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2', 'b3']);
    expect(A!.store.has('session-secondary:B')).toBe(false);
    A!.send('B', 'a2');
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2']);
    A!.send('B', 'a3');
    B!.send('A', 'b4');
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'b2', 'b3', 'b4']);
  });
});
