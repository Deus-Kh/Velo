/**
 * S25 — Peer resets its session locally and re-initiates (T2.11).
 * Checklist: §7.2 (manual session reset).
 * Defect covered: an initPacket arriving for an established session was
 * ignored, so a peer's local reset broke the conversation until the other
 * side also reset by hand.
 * Expected: the packet's session is adopted when its message decrypts (the
 * peer proved it holds the pinned identity); a bogus packet leaves the
 * established session untouched; the peer's own replayed bootstrap is
 * refused.
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S25 peer reset', () => {
  it('a peer that reset locally is adopted on its next message; no manual reset on this side', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'a1');
    B!.send('A', 'b1');

    B!.resetSession('A'); // "Reset secure session" on B
    const fresh = B!.send('A', 'fresh start'); // B bootstraps a new session toward A
    expect(fresh.initPacket).not.toBeNull();
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'fresh start']);
    expect(A!.sessionState('B')!.DHrPublicKey).toBe(B!.sentHeader(fresh.clientMessageId).dhPub);

    A!.send('B', 'a2');
    B!.send('A', 'b2');
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['b1', 'fresh start', 'b2']);
  });

  it('a bogus packet against an established session changes nothing and is DECRYPT_FAILED', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'a1');
    B!.send('A', 'b1');
    const before = A!.sessionState('B');

    // B "resets" and re-initiates, but the packet's ephemeral key is swapped on the wire.
    B!.resetSession('A');
    const remove = network.tamper((dto) => (dto.initPacket ? { ...dto, initPacket: { ...dto.initPacket, ephPublicKey: encodeBase64(nacl.box.keyPair().publicKey) } } : dto));
    network.hold('A');
    B!.send('A', 'forged');
    const [r] = network.release('A');
    remove();
    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('DECRYPT_FAILED');
    expect(A!.sessionState('B')).toEqual(before);
    expect(A!.store.has('session-secondary:B')).toBe(false);
  });
});
