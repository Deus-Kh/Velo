import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import { MAX_SKIP, ratchetDecrypt, ratchetEncrypt, skippedKeyId } from '../src/ratchet/message';
import type { RatchetSessionV2 } from '../src/types/session';
import type { V2Encrypted } from '../src/ratchet/message';
import { protocolErrorCode } from '../src/errors';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const pairB64 = (byte: number) => {
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(byte));
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
};
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const spkB = pairB64(0x44);
const dhsA0 = pairB64(0x66);

/** Fresh A (initiator) and B (responder) sessions sharing SK and SPK_B. */
function pair() {
  return {
    a: initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 }),
    b: initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey: spkB }),
  };
}

const snapshot = (s: RatchetSessionV2) => JSON.parse(JSON.stringify(s));

describe('ratchetEncrypt / ratchetDecrypt', () => {
  it('round-trips in both directions; the responder ratchets on the first message', () => {
    let { a, b } = pair();
    const a0 = snapshot(a);
    const b0 = snapshot(b);

    const e1 = ratchetEncrypt(a, 'hello');
    expect(a).toEqual(a0);
    expect(e1.session.Ns).toBe(1);
    expect(e1.envelope.header).toEqual({ n: 0, pn: 0, dhPub: dhsA0.publicKey });
    expect(e1.derivedKeys).toEqual([{ direction: 'out', dhPub: dhsA0.publicKey, n: 0, messageKeyB64: expect.any(String) }]);
    a = e1.session;

    const d1 = ratchetDecrypt(b, e1.envelope);
    expect(b).toEqual(b0);
    expect(d1.plaintext).toBe('hello');
    expect(d1.session.Nr).toBe(1);
    expect(d1.session.DHrPublicKey).toBe(dhsA0.publicKey);
    expect(d1.session.DHsPublicKey, 'responder rotated its ratchet key on the first inbound message (R13)').not.toBe(spkB.publicKey);
    expect(d1.session.chainKeySend, 'responder now has a sending chain').not.toBeNull();
    expect(d1.consumedSkippedKeyId).toBeNull();
    expect(d1.derivedKeys).toEqual([{ direction: 'in', dhPub: dhsA0.publicKey, n: 0, messageKeyB64: e1.derivedKeys[0]!.messageKeyB64 }]);
    b = d1.session;

    const e2 = ratchetEncrypt(b, 'reply');
    expect(e2.envelope.header.dhPub).toBe(b.DHsPublicKey);
    const d2 = ratchetDecrypt(a, e2.envelope);
    expect(d2.plaintext).toBe('reply');
    expect(d2.session.DHsPublicKey, 'initiator ratchets when the reply carries a new key').not.toBe(dhsA0.publicKey);
    expect(d2.session.rootKey).not.toBe(a.rootKey);
  });

  it('a responder cannot send before it has received (no sending chain)', () => {
    const { b } = pair();
    let code: string | null = null;
    try {
      ratchetEncrypt(b, 'too early');
    } catch (e) {
      code = protocolErrorCode(e);
    }
    expect(code).toBe('SESSION_RESET_REQUIRED');
  });

  it('is byte-for-byte reproducible for fixed keys and nonce (frozen vector, R8)', () => {
    const { a } = pair();
    const nonce = new Uint8Array(24).fill(7);
    const e = ratchetEncrypt(a, 'frozen', { nonce });
    expect(hex(decodeBase64(e.envelope.ciphertext))).toBe('9b0bf1649ea6c576da8031f77e7656756cbad711038e');
    expect(e.derivedKeys[0]!.messageKeyB64).toBe('H2aBZ1EfCv9gSutc3498EfvPNs3F894IhY76KH9L1W0=');
    expect(hex(decodeBase64(e.session.chainKeySend!))).toBe('baef9e3452b0b1538d0725e04b82ba282048d06623f19d0854df1383e1184a26');
  });

  it('decrypts out-of-order messages within an epoch via skipped keys and reports the consumed id', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0');
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1');
    a = e1.session;
    const e2 = ratchetEncrypt(a, 'm2');
    a = e2.session;

    const d2 = ratchetDecrypt(b, e2.envelope);
    expect(d2.plaintext).toBe('m2');
    expect(d2.derivedKeys.map((k) => k.n)).toEqual([0, 1, 2]);
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([skippedKeyId(dhsA0.publicKey, 0), skippedKeyId(dhsA0.publicKey, 1)]);
    b = d2.session;

    const d0 = ratchetDecrypt(b, e0.envelope);
    expect(d0.plaintext).toBe('m0');
    expect(d0.consumedSkippedKeyId).toBe(skippedKeyId(dhsA0.publicKey, 0));
    expect(Object.keys(d0.session.skippedKeys ?? {})).toEqual([skippedKeyId(dhsA0.publicKey, 1)]);
    expect(d0.derivedKeys).toEqual([{ direction: 'in', dhPub: dhsA0.publicKey, n: 0, messageKeyB64: e0.derivedKeys[0]!.messageKeyB64 }]);
    b = d0.session;

    // Replay of an already-consumed message is refused.
    expect(() => ratchetDecrypt(b, e0.envelope)).toThrow('Replay or unknown old message');
  });

  it('a failed decrypt throws and leaves the input session deep-equal to before (R7)', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0');
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1');
    a = e1.session;
    const before = snapshot(b);

    const flipped = decodeBase64(e1.envelope.ciphertext).map((x) => x ^ 1);
    const tampered = { ...e1.envelope, ciphertext: encodeBase64(new Uint8Array(flipped)) };
    expect(() => ratchetDecrypt(b, tampered)).toThrow('secretbox.open failed');
    expect(b).toEqual(before);

    // Nothing was consumed: the genuine messages still decrypt afterwards.
    expect(ratchetDecrypt(b, e1.envelope).plaintext).toBe('m1');
    expect(ratchetDecrypt(b, e0.envelope).plaintext).toBe('m0');
  });

  it('a tampered skipped-key message throws and keeps the skipped key', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0');
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1');
    a = e1.session;
    b = ratchetDecrypt(b, e1.envelope).session;
    const before = snapshot(b);

    const tampered = { ...e0.envelope, nonce: encodeBase64(new Uint8Array(24)) };
    expect(() => ratchetDecrypt(b, tampered)).toThrow('secretbox.open failed');
    expect(b).toEqual(before);
    expect(ratchetDecrypt(b, e0.envelope).plaintext).toBe('m0');
  });

  it('retains at most MAX_SKIP skipped keys within an epoch (pinned; T2.6 changes the policy)', () => {
    let { a, b } = pair();
    const envelopes: V2Encrypted[] = [];
    for (let i = 0; i < MAX_SKIP + 10; i += 1) {
      const e = ratchetEncrypt(a, 'm' + String(i));
      a = e.session;
      envelopes.push(e.envelope);
    }
    const last = ratchetDecrypt(b, envelopes[envelopes.length - 1]!);
    expect(Object.keys(last.session.skippedKeys ?? {}).length).toBe(MAX_SKIP);
    expect(last.derivedKeys.length).toBe(MAX_SKIP + 10);
    b = last.session;
    // Beyond the bound the old message is unrecoverable (current behaviour).
    expect(() => ratchetDecrypt(b, envelopes[MAX_SKIP + 5]!)).toThrow('Replay or unknown old message');
  });

  it('a previous-epoch message arriving after the next epoch decrypts from a key drained via pn (T2.7 + T2.8)', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'a0');
    a = e0.session;
    b = ratchetDecrypt(b, e0.envelope).session; // B ratchets (B0)
    const eb0 = ratchetEncrypt(b, 'b0');
    b = eb0.session;
    a = ratchetDecrypt(a, eb0.envelope).session; // A ratchets: epoch A1

    const a1 = ratchetEncrypt(a, 'a1'); // A1, n = 0
    a = a1.session;
    const a1b = ratchetEncrypt(a, 'a1b'); // A1, n = 1 — delivered last
    a = a1b.session;

    b = ratchetDecrypt(b, a1.envelope).session; // B ratchets (B1)
    const eb1 = ratchetEncrypt(b, 'b1');
    b = eb1.session;
    a = ratchetDecrypt(a, eb1.envelope).session; // A ratchets: epoch A2
    const a2 = ratchetEncrypt(a, 'a2'); // A2, n = 0, pn = 2
    expect(a2.envelope.header.pn).toBe(2);
    expect(a2.envelope.header.dhPub).not.toBe(a1.envelope.header.dhPub);

    // B receives a2 first: drains epoch A1 to pn = 2 (a1b's key retained), ratchets, decrypts.
    const d2 = ratchetDecrypt(b, a2.envelope);
    expect(d2.plaintext).toBe('a2');
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([skippedKeyId(a1.envelope.header.dhPub, 1)]);
    expect(d2.derivedKeys).toEqual([
      { direction: 'in', dhPub: a1.envelope.header.dhPub, n: 1, messageKeyB64: a1b.derivedKeys[0]!.messageKeyB64 },
      { direction: 'in', dhPub: a2.envelope.header.dhPub, n: 0, messageKeyB64: a2.derivedKeys[0]!.messageKeyB64 },
    ]);
    b = d2.session;

    // The late a1b now decrypts from the retained key.
    const d1b = ratchetDecrypt(b, a1b.envelope);
    expect(d1b.plaintext).toBe('a1b');
    expect(d1b.consumedSkippedKeyId).toBe(skippedKeyId(a1.envelope.header.dhPub, 1));
    expect(Object.keys(d1b.session.skippedKeys ?? {})).toHaveLength(0);
  });

  it('never adopts a peer key without ratcheting: the root key changes on every new peer key (R13)', () => {
    let { a, b } = pair();
    const roots = new Set<string>([a.rootKey, b.rootKey]);
    for (let i = 0; i < 4; i += 1) {
      const ea = ratchetEncrypt(a, 'a' + String(i));
      a = ea.session;
      b = ratchetDecrypt(b, ea.envelope).session;
      roots.add(b.rootKey);
      const eb = ratchetEncrypt(b, 'b' + String(i));
      b = eb.session;
      a = ratchetDecrypt(a, eb.envelope).session;
      roots.add(a.rootKey);
    }
    // 2 initial + one new root per direction change on each side (8 changes).
    expect(roots.size).toBe(2 + 8);
  });

  it('rejects a corrupted session without a sending key and a wrong-size nonce', () => {
    const { a } = pair();
    expect(() => ratchetEncrypt({ ...a, DHsPublicKey: null as unknown as string }, 'x')).toThrow('Session missing DHsPublicKey');
    expect(() => ratchetEncrypt(a, 'x', { nonce: new Uint8Array(12) })).toThrow('nonce must be 24 bytes');
  });
});
