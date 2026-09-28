/**
 * S24 — Bootstrap lifecycle (T2.11, P1-11).
 * Checklist: §7 (initPacket policy).
 * Defects covered: the one-time prekey secret was deleted before the
 * session existed, and the responder session was persisted before the
 * first message was authenticated (R7). A replayed first message could
 * re-create an old session.
 * Expected: a genuine bootstrap persists the session and only then drops
 * the one-time prekey secret; a bogus packet (wrong ephemeral) leaves no
 * session, keeps the one-time prekey secret and is DECRYPT_FAILED; a
 * replayed first message is REPLAY_DETECTED and leaves the session as is.
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S24 bootstrap lifecycle', () => {
  it('a genuine bootstrap persists the session and consumes the one-time prekey secret', () => {
    const { clients } = makeWorld();
    const { A, B } = clients;
    const first = A!.send('B', 'hello');
    expect(B!.hasSession('A')).toBe(true);
    expect(B!.store.has('opk:' + String(first.initPacket!.oneTimePreKeyId))).toBe(false);
    expect(B!.inbox.map((m) => m.text)).toEqual(['hello']);
  });

  it('a bogus packet leaves no session and keeps the one-time prekey secret', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    // A's genuine first message, but the ephemeral key on the wire is swapped: the
    // shared secret differs, the message cannot decrypt, nothing may be persisted.
    const remove = network.tamper((dto) => (dto.initPacket ? { ...dto, initPacket: { ...dto.initPacket, ephPublicKey: encodeBase64(nacl.box.keyPair().publicKey) } } : dto));
    network.hold('B');
    const first = A!.send('B', 'hello');
    const [r] = network.release('B');
    remove();
    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('DECRYPT_FAILED');
    expect(B!.hasSession('A')).toBe(false);
    expect(B!.store.has('opk:' + String(first.initPacket!.oneTimePreKeyId)), 'a failed bootstrap must not burn the one-time prekey').toBe(true);
    expect(B!.messageKeyCount('A')).toBe(0);
  });

  it('a replayed first message is REPLAY_DETECTED and does not disturb the session', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    network.hold('B');
    A!.send('B', 'first');
    network.duplicate('B', 0);
    const [ok, replay] = network.release('B');
    expect(ok!.ok).toBe(true);
    const after = B!.sessionState('A');
    expect(replay!.ok).toBe(false);
    expect(replay!.ok ? null : replay!.code).toBe('REPLAY_DETECTED');
    expect(B!.sessionState('A')).toEqual(after);

    // The conversation continues normally.
    B!.send('A', 'reply');
    A!.send('B', 'second');
    expect(B!.inbox.map((m) => m.text)).toEqual(['first', 'second']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['reply']);
  });
});
