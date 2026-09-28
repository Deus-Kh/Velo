/**
 * G03 — Forged sender (T6.1 per-sender signatures).
 * Spec §7b T6.6. The server (or an on-path attacker) relabels a member's
 * message as another member's; an insider forges the victim's keyId with
 * its own signature; a byte of ciphertext is flipped. None is accepted,
 * none advances the victim's chain at the receiver, and the receiver asks
 * for a key only where a missing key is the plausible cause.
 * Expected: green from the start (written with T6.6).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('G03 group forged sender', () => {
  it('a relabelled copy is stale for the claimed sender and never opens, even after that sender re-sends its key', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'genuine A');

    const stop = network.tamperGroup((c) => (c.toUserId === 'C' ? { ...c, fromUserId: 'A' } : c));
    B!.sendGroup(g, 'from B, labelled A');
    stop();

    const r = network.log.at(-1)!;
    expect(r.ok ? null : r.code).toBe('SENDER_KEY_STALE'); // B's keyId is not A's
    expect(C!.keyRequestsSent).toEqual([{ to: 'A', groupId: g }]); // C asked A, A answered with the same key: still not B's
    expect(A!.distributionsSent.filter((d) => d.to === 'C')).toHaveLength(2);
    expect(C!.groupMessages(g)).toEqual(['genuine A']);
    expect(A!.groupMessages(g)).toEqual(['genuine A', 'from B, labelled A']); // A's own copy was not tampered
    // The attack was on the wire: the server still holds the genuine copy, attributed to B, and the next sync opens it as B's.
    expect(server.undeliveredGroup('C', g).map((c) => c.fromUserId)).toEqual(['B']);
    expect(C!.loadGroupHistory(g).map((m) => [m.from, m.text])).toEqual([['A', 'genuine A'], ['B', 'from B, labelled A']]);
    expect(server.undeliveredGroup('C', g)).toHaveLength(0);
  });

  it('an insider who forges the victim’s keyId fails the signature; a flipped ciphertext byte fails it too', { timeout: 30_000 }, () => {
    const { network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    A!.sendGroup(g, 'genuine A');
    const aState = C!.peerSenderKey(g, 'A')!;
    const requestsBefore = C!.keyRequestsSent.length;

    // B signs with its own key but claims A's keyId and A's name.
    const stopForge = network.tamperGroup((c) => (c.toUserId === 'C' ? { ...c, fromUserId: 'A', g1: { ...c.g1, keyId: aState.keyId } } : c));
    B!.sendGroup(g, 'forged as A');
    stopForge();
    let r = network.log.at(-1)!;
    expect(r.ok ? null : r.code).toBe('SENDER_KEY_SIGNATURE_INVALID');
    expect(C!.peerSenderKey(g, 'A')).toEqual(aState); // nothing derived, nothing advanced

    // A genuine copy with one ciphertext byte flipped: the signature covers the ciphertext.
    const stopFlip = network.tamperGroup((c) => {
      if (c.toUserId !== 'C') return c;
      const bytes = Buffer.from(c.g1.ciphertext, 'base64');
      bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0x01) & 0xff;
      return { ...c, g1: { ...c.g1, ciphertext: bytes.toString('base64') } };
    });
    A!.sendGroup(g, 'flipped on the wire');
    stopFlip();
    r = network.log.at(-1)!;
    expect(r.ok ? null : r.code).toBe('SENDER_KEY_SIGNATURE_INVALID');
    expect(C!.peerSenderKey(g, 'A')).toEqual(aState);
    expect(C!.keyRequestsSent).toHaveLength(requestsBefore); // a bad signature is never a reason to ask for a key

    // The genuine copies wait on the server; the next sync opens them (the forgery was never stored).
    expect(C!.loadGroupHistory(g).map((m) => m.text)).toEqual(['genuine A', 'forged as A', 'flipped on the wire']);
    expect(C!.groupInbox.map((m) => m.fromUserId)).toEqual(['A', 'B', 'A']);
  });
});
