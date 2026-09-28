import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import {
  rotateSignedPreKeySet,
  selectSignedPreKey,
  SIGNED_PREKEY_RETAIN_MS,
  SIGNED_PREKEY_ROTATE_AFTER_MS,
  signedPreKeyMessage,
  signSignedPreKey,
  verifySignedPreKey,
  type SignedPreKeyRecord,
  type SignedPreKeySet,
} from '../src/handshake/signedPrekey';

const DAY = 24 * 60 * 60 * 1000;
const identity = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x11));
const idPub = encodeBase64(identity.publicKey);

function record(keyId: number, createdAt: number): SignedPreKeyRecord {
  const kp = nacl.box.keyPair();
  const publicKey = encodeBase64(kp.publicKey);
  return { keyId, publicKey, privateKey: encodeBase64(kp.secretKey), signature: signSignedPreKey(identity.secretKey, keyId, publicKey), createdAt };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
}

describe('signed prekey signature (domain ‖ keyId ‖ publicKey)', () => {
  it('signs and verifies; the key id is part of the signed message', () => {
    const r = record(42, 0);
    expect(verifySignedPreKey({ identitySignPublicKey: idPub, keyId: 42, publicKey: r.publicKey, signature: r.signature })).toBe(true);
    // Same signature, different key id: refused (no replay onto another id).
    expect(verifySignedPreKey({ identitySignPublicKey: idPub, keyId: 43, publicKey: r.publicKey, signature: r.signature })).toBe(false);
    // Pre-T2.10 signature over the bare public key: refused.
    const legacy = encodeBase64(nacl.sign.detached(nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(1)).publicKey, identity.secretKey));
    expect(verifySignedPreKey({ identitySignPublicKey: idPub, keyId: 42, publicKey: r.publicKey, signature: legacy })).toBe(false);
    // Wrong identity.
    const other = nacl.sign.keyPair();
    expect(verifySignedPreKey({ identitySignPublicKey: encodeBase64(other.publicKey), keyId: 42, publicKey: r.publicKey, signature: r.signature })).toBe(false);
    expect(verifySignedPreKey({ identitySignPublicKey: idPub, keyId: 42, publicKey: r.publicKey, signature: 'not base64!' })).toBe(false);
  });

  it('message layout is domain ‖ u32be keyId ‖ 32-byte key', () => {
    const r = record(0x01020304, 0);
    const m = signedPreKeyMessage(0x01020304, r.publicKey);
    const domain = Buffer.from('velo-signed-prekey-v1', 'utf8');
    expect(m.length).toBe(domain.length + 4 + 32);
    expect(Buffer.from(m.subarray(0, domain.length)).toString('utf8')).toBe('velo-signed-prekey-v1');
    expect(Array.from(m.subarray(domain.length, domain.length + 4))).toEqual([1, 2, 3, 4]);
    expect(codeOf(() => signedPreKeyMessage(-1, r.publicKey))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => signedPreKeyMessage(1, encodeBase64(new Uint8Array(16))))).toBe('INVALID_KEY_LENGTH');
  });
});

describe('rotation policy', () => {
  let counter = 100;
  const generate = (now: number) => record(++counter, now);

  it('a missing or legacy set gets a fresh key; nothing rotates before 7 days; rotation retires the current key', () => {
    const t0 = 1_000_000;
    const first = rotateSignedPreKeySet(null, t0, generate);
    expect(first.rotated).toBe(true);
    expect(first.set.previous).toEqual([]);

    const sameDay = rotateSignedPreKeySet(first.set, t0 + 6 * DAY, generate);
    expect(sameDay.rotated).toBe(false);
    expect(sameDay.set.current).toBe(first.set.current);

    const legacy = { keyId: 1, publicKey: 'x', privateKey: 'y', signature: 'z' } as unknown as SignedPreKeySet;
    expect(rotateSignedPreKeySet(legacy, t0, generate).rotated).toBe(true);

    const week = rotateSignedPreKeySet(first.set, t0 + SIGNED_PREKEY_ROTATE_AFTER_MS, generate);
    expect(week.rotated).toBe(true);
    expect(week.set.current.keyId).not.toBe(first.set.current.keyId);
    expect(week.set.previous.map((p) => p.keyId)).toEqual([first.set.current.keyId]);

    // Retained keys expire after 30 days; a current key older than 30 days is not retained at all.
    const month = rotateSignedPreKeySet(week.set, t0 + SIGNED_PREKEY_RETAIN_MS + 1, generate);
    expect(month.set.previous.map((p) => p.keyId)).toEqual([week.set.current.keyId]);
    const stale = rotateSignedPreKeySet({ v: 2, current: record(7, t0), previous: [] }, t0 + 40 * DAY, generate);
    expect(stale.set.previous).toEqual([]);
  });

  it('selects the current or a retained key by id; 20 days old completes, 31 days old and unknown ids are SESSION_RESET_REQUIRED', () => {
    const t0 = 5_000_000;
    const old = record(1, t0);
    const set: SignedPreKeySet = { v: 2, current: record(2, t0 + 7 * DAY), previous: [old] };
    expect(selectSignedPreKey(set, 2, t0 + 8 * DAY).keyId).toBe(2);
    expect(selectSignedPreKey(set, 1, t0 + 20 * DAY).keyId).toBe(1);
    expect(codeOf(() => selectSignedPreKey(set, 1, t0 + 31 * DAY))).toBe('SESSION_RESET_REQUIRED');
    expect(codeOf(() => selectSignedPreKey(set, 9, t0))).toBe('SESSION_RESET_REQUIRED');
    expect(codeOf(() => selectSignedPreKey(null, 2, t0))).toBe('SESSION_RESET_REQUIRED');
  });
});
