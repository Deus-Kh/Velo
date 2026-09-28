import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { createSessionFromX3DH } from '../src/ratchet/session';
import { MAX_SKIP, ratchetDecrypt, ratchetEncrypt, skippedKeyId } from '../src/ratchet/message';
import type { RatchetSessionV2 } from '../src/types/session';
import type { V2Encrypted } from '../src/ratchet/message';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rootKey = encodeBase64(new Uint8Array(32).fill(0xaa));
const chainKey = encodeBase64(new Uint8Array(32).fill(0xbb));
const dhsA = { publicKey: encodeBase64(new Uint8Array(32).fill(1)), privateKey: encodeBase64(new Uint8Array(32).fill(2)) };
const dhsB = { publicKey: encodeBase64(new Uint8Array(32).fill(3)), privateKey: encodeBase64(new Uint8Array(32).fill(4)) };

function pair() {
  return {
    a: createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true, dhs: dhsA }),
    b: createSessionFromX3DH({ peerUserId: 'a', rootKey, chainKey, isInitiator: false, dhs: dhsB }),
  };
}

const snapshot = (s: RatchetSessionV2) => JSON.parse(JSON.stringify(s));

describe('ratchetEncrypt / ratchetDecrypt', () => {
  it('round-trips in both directions and advances counters without touching the inputs', () => {
    let { a, b } = pair();
    const a0 = snapshot(a);
    const b0 = snapshot(b);

    const e1 = ratchetEncrypt(a, 'hello');
    expect(a).toEqual(a0);
    expect(e1.session.Ns).toBe(1);
    expect(e1.envelope.header).toEqual({ n: 0, pn: 0, dhPub: dhsA.publicKey });
    expect(e1.derivedKeys).toEqual([
      { direction: 'out', dhPub: dhsA.publicKey, n: 0, messageKeyB64: expect.any(String) },
    ]);
    a = e1.session;

    const d1 = ratchetDecrypt(b, e1.envelope);
    expect(b).toEqual(b0);
    expect(d1.plaintext).toBe('hello');
    expect(d1.session.Nr).toBe(1);
    expect(d1.session.DHrPublicKey).toBe(dhsA.publicKey);
    expect(d1.consumedSkippedKeyId).toBeNull();
    expect(d1.derivedKeys).toEqual([
      { direction: 'in', dhPub: dhsA.publicKey, n: 0, messageKeyB64: e1.derivedKeys[0]!.messageKeyB64 },
    ]);
    b = d1.session;

    const e2 = ratchetEncrypt(b, 'reply');
    const d2 = ratchetDecrypt(a, e2.envelope);
    expect(d2.plaintext).toBe('reply');
  });

  it('is byte-for-byte the pre-T2.2 client output for a fixed nonce (frozen vector, R8)', () => {
    const { a } = pair();
    const nonce = new Uint8Array(24).fill(7);
    const e = ratchetEncrypt(a, 'frozen', { nonce });
    expect(hex(decodeBase64(e.envelope.ciphertext))).toBe('b196fb8f742e24faf436b26cb915d2cabfd583868c73');
    expect(e.derivedKeys[0]!.messageKeyB64).toBe('+1agv9GTeqVHb+tqJTSxesj0c2IV4e+LTRdm5fyGM8I=');
    expect(hex(decodeBase64(e.session.chainKeySend))).toBe('b47940b609e3514bcd7d26165402f235bc887646a3701a4be284cd4bb8b9186c');
  });

  it('decrypts out-of-order messages via skipped keys and reports the consumed id', () => {
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
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([
      skippedKeyId(dhsA.publicKey, 0),
      skippedKeyId(dhsA.publicKey, 1),
    ]);
    b = d2.session;

    const d0 = ratchetDecrypt(b, e0.envelope);
    expect(d0.plaintext).toBe('m0');
    expect(d0.consumedSkippedKeyId).toBe(skippedKeyId(dhsA.publicKey, 0));
    expect(Object.keys(d0.session.skippedKeys ?? {})).toEqual([skippedKeyId(dhsA.publicKey, 1)]);
    expect(d0.derivedKeys).toEqual([
      { direction: 'in', dhPub: dhsA.publicKey, n: 0, messageKeyB64: e0.derivedKeys[0]!.messageKeyB64 },
    ]);
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

  it('retains at most MAX_SKIP skipped keys (pinned; T2.6 changes the policy)', () => {
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

  it('pins the P1-0 defect: a null DHr adopts the peer key without ratcheting', () => {
    const { a, b } = pair();
    const e = ratchetEncrypt(a, 'x');
    const d = ratchetDecrypt(b, e.envelope);
    expect(d.session.rootKey).toBe(b.rootKey);
    expect(d.session.DHsPublicKey).toBe(b.DHsPublicKey);
    expect(d.session.DHrPublicKey).toBe(dhsA.publicKey);
  });

  it('rejects a session without a sending key and a wrong-size nonce', () => {
    const { a } = pair();
    expect(() => ratchetEncrypt({ ...a, DHsPublicKey: null }, 'x')).toThrow('Session missing DHsPublicKey');
    expect(() => ratchetEncrypt(a, 'x', { nonce: new Uint8Array(12) })).toThrow('nonce must be 24 bytes');
  });
});
