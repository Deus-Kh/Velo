import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import { signIdentityBinding, verifyIdentityBinding, type BoundIdentity } from '../src/identity/binding';
import { computeSafetyNumber, displayableFingerprint, fingerprintHalf, groupDigits } from '../src/identity/fingerprint';
import { checkIdentity, requireIdentityMatch } from '../src/identity/trust';
import vectors from './vectors/libsignal.json';

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

function identity(seed: number): BoundIdentity & { signSecret: Uint8Array } {
  const sign = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
  const dh = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(seed + 1));
  const identityDhPublicKey = encodeBase64(dh.publicKey);
  return {
    identitySignPublicKey: encodeBase64(sign.publicKey),
    identityDhPublicKey,
    identityBindingSignature: signIdentityBinding(sign.secretKey, identityDhPublicKey),
    signSecret: sign.secretKey,
  };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
}

describe('identity binding', () => {
  it('a binding signed by the identity signing key verifies; anything else is IDENTITY_BINDING_INVALID', () => {
    const a = identity(0x10);
    expect(() => verifyIdentityBinding(a)).not.toThrow();

    const other = identity(0x20);
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityDhPublicKey: other.identityDhPublicKey }))).toBe('IDENTITY_BINDING_INVALID');
    expect(codeOf(() => verifyIdentityBinding({ ...a, identitySignPublicKey: other.identitySignPublicKey }))).toBe('IDENTITY_BINDING_INVALID');
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityBindingSignature: other.identityBindingSignature }))).toBe('IDENTITY_BINDING_INVALID');
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityBindingSignature: '' }))).toBe('IDENTITY_BINDING_INVALID');
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityBindingSignature: 'not base64!!' }))).toBe('IDENTITY_BINDING_INVALID');
  });

  it('is domain-separated: a plain signature over the DH key does not verify as a binding', () => {
    const a = identity(0x30);
    const plain = encodeBase64(nacl.sign.detached(decodeBase64(a.identityDhPublicKey), a.signSecret));
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityBindingSignature: plain }))).toBe('IDENTITY_BINDING_INVALID');
  });

  it('rejects wrong key lengths with INVALID_KEY_LENGTH', () => {
    const a = identity(0x40);
    expect(codeOf(() => signIdentityBinding(new Uint8Array(32), a.identityDhPublicKey))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => verifyIdentityBinding({ ...a, identityDhPublicKey: encodeBase64(new Uint8Array(16)) }))).toBe('INVALID_KEY_LENGTH');
  });
});

describe('identity trust check', () => {
  const a = identity(0x50);
  const b = identity(0x60);

  it('first contact, match, and mismatch on either key', () => {
    expect(checkIdentity(null, a)).toBe('first-contact');
    expect(checkIdentity(a, a)).toBe('match');
    expect(checkIdentity(a, { ...a, identityDhPublicKey: b.identityDhPublicKey })).toBe('mismatch');
    expect(checkIdentity(a, { ...a, identitySignPublicKey: b.identitySignPublicKey })).toBe('mismatch');
    expect(checkIdentity(a, b)).toBe('mismatch');
  });

  it('a legacy pin without a DH key matches on the signing key (binding verified by the caller)', () => {
    expect(checkIdentity({ identitySignPublicKey: a.identitySignPublicKey, identityDhPublicKey: null }, a)).toBe('match');
    expect(checkIdentity({ identitySignPublicKey: a.identitySignPublicKey, identityDhPublicKey: null }, b)).toBe('mismatch');
  });

  it('requireIdentityMatch throws IDENTITY_MISMATCH with public, truncated context only', () => {
    expect(requireIdentityMatch(null, a, 'peer')).toBe('first-contact');
    expect(requireIdentityMatch(a, a, 'peer')).toBe('match');
    let ctx: Record<string, unknown> | null = null;
    try {
      requireIdentityMatch(a, b, 'peer');
    } catch (e) {
      expect(protocolErrorCode(e)).toBe('IDENTITY_MISMATCH');
      ctx = (e as { context: Record<string, unknown> }).context;
    }
    expect(ctx).toEqual({ peerUserId: 'peer', pinnedSign: a.identitySignPublicKey.slice(0, 8), presentedSign: b.identitySignPublicKey.slice(0, 8) });
  });
});

describe('numeric fingerprint', () => {
  it('reproduces libsignal’s displayable fingerprint for the T2.15 vectors (0x05-serialized key)', () => {
    for (const v of vectors.fingerprints) {
      const enc = new TextEncoder();
      const local = fingerprintHalf({ identifier: enc.encode(v.localIdentifier), identityKey: fromHex(v.localKeySerialized), iterations: v.iterations, version: v.version });
      const remote = fingerprintHalf({ identifier: enc.encode(v.remoteIdentifier), identityKey: fromHex(v.remoteKeySerialized), iterations: v.iterations, version: v.version });
      expect(displayableFingerprint(local, remote)).toBe(v.display);
    }
  });

  it('Velo safety number covers both identity keys, is symmetric, and changes when the DH key changes (P0-9)', () => {
    const a = identity(0x70);
    const b = identity(0x80);
    const fromA = computeSafetyNumber({ myUserId: 'A', myIdentity: a, theirUserId: 'B', theirIdentity: b });
    const fromB = computeSafetyNumber({ myUserId: 'B', myIdentity: b, theirUserId: 'A', theirIdentity: a });
    expect(fromA.display).toBe(fromB.display);
    expect(fromA.display).toMatch(/^\d{60}$/);
    expect(fromA.grouped.split(' ')).toHaveLength(12);
    expect(groupDigits(fromA.display)).toBe(fromA.grouped);

    const swappedDh = computeSafetyNumber({ myUserId: 'A', myIdentity: a, theirUserId: 'B', theirIdentity: { ...b, identityDhPublicKey: identity(0x90).identityDhPublicKey } });
    expect(swappedDh.display).not.toBe(fromA.display);
    const otherUser = computeSafetyNumber({ myUserId: 'A', myIdentity: a, theirUserId: 'C', theirIdentity: b });
    expect(otherUser.display).not.toBe(fromA.display);
  });
});
