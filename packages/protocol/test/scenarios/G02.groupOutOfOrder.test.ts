/**
 * G02 — Out of order across senders (T6.1 skipped keys, T3.2 ordering).
 * Spec §7b T6.6. A member's copies arrive reversed and interleaved across
 * two senders; every one opens (skipped keys per chain), the local order is
 * the server's sequence, a duplicate is a replay, nothing lingers.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('G02 group out of order across senders', () => {
  it('reversed delivery opens every message; local order is the server sequence; a duplicate is a replay', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);

    network.hold('C');
    A!.sendGroup(g, 'a1');
    B!.sendGroup(g, 'b1');
    A!.sendGroup(g, 'a2');
    B!.sendGroup(g, 'b2');
    A!.sendGroup(g, 'a3');
    expect(network.pending('C')).toHaveLength(5);
    network.reorder('C', 'reverse');
    const results = network.release('C');

    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true]);
    expect(C!.groupInbox.map((m) => m.text)).toEqual(['a3', 'b2', 'a2', 'b1', 'a1']); // arrival order
    expect(C!.groupMessages(g)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']); // server order
    expect(B!.groupMessages(g)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
    // Every skipped key was consumed: nothing retained.
    expect(C!.peerSenderKey(g, 'A')!.skippedKeys).toEqual({});
    expect(C!.peerSenderKey(g, 'B')!.skippedKeys).toEqual({});
    expect(C!.peerSenderKey(g, 'A')!.iteration).toBe(3);
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);

    // A duplicate of a delivered copy is a replay: refused, not stored twice, nothing to ack.
    network.hold('C');
    A!.sendGroup(g, 'a4');
    network.duplicate('C');
    const dup = network.release('C');
    expect(dup.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok', 'REPLAY_DETECTED']);
    expect(C!.groupMessages(g)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'a4']);
    expect(server.heldCiphertextCount('group:' + g)).toBe(0);
  });

  it('a gap that exceeds the per-step bound is refused and does not advance the chain', { timeout: 30_000 }, () => {
    const { network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    network.hold('C');
    for (let i = 0; i < 102; i += 1) A!.sendGroup(g, 'm' + String(i));
    // Deliver the last one first: 101 skipped keys is over MAX_SKIP_PER_STEP (100).
    const r = network.releaseOne('C', 101);
    expect(r && !r.ok ? r.code : null).toBe('TOO_MANY_SKIPPED');
    expect(C!.peerSenderKey(g, 'A')!.iteration).toBe(0);
    // The rest, in order, opens; the last one then opens too (it is now only one step ahead).
    const rest = network.release('C');
    expect(rest.every((x) => x.ok)).toBe(true);
    expect(C!.groupMessages(g)).toHaveLength(101);
    expect(C!.loadGroupHistory(g)).toHaveLength(102); // the refused copy waited on the server and opens on the next sync
  });
});
