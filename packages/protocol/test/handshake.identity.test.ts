import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { verifySignedPreKeyBundle } from '../src/handshake/bundle';
import type { PreKeyBundle } from '../src/handshake/types';
import { computeSafetyNumber } from '../src/identity/fingerprint';

function bundleFor(identity = nacl.sign.keyPair(), spk = nacl.box.keyPair()): PreKeyBundle {
  return {
    userId: 'u',
    identitySignPublicKey: encodeBase64(identity.publicKey),
    identityDhPublicKey: encodeBase64(nacl.box.keyPair().publicKey),
    signedPreKey: {
      keyId: 1,
      publicKey: encodeBase64(spk.publicKey),
      signature: encodeBase64(nacl.sign.detached(spk.publicKey, identity.secretKey)),
    },
    oneTimePreKey: null,
  };
}

describe('verifySignedPreKeyBundle', () => {
  it('accepts a bundle whose signed prekey is signed by the bundle identity', () => {
    expect(() => verifySignedPreKeyBundle(bundleFor())).not.toThrow();
  });

  it('rejects a substituted signed prekey or a foreign signature', () => {
    const b = bundleFor();
    const swapped = { ...b, signedPreKey: { ...b.signedPreKey, publicKey: encodeBase64(nacl.box.keyPair().publicKey) } };
    expect(() => verifySignedPreKeyBundle(swapped)).toThrow(/Invalid signedPreKey signature/);

    const other = nacl.sign.keyPair();
    const foreign = { ...b, signedPreKey: { ...b.signedPreKey, signature: encodeBase64(nacl.sign.detached(new Uint8Array(32), other.secretKey)) } };
    expect(() => verifySignedPreKeyBundle(foreign)).toThrow();
  });

  it('is self-referential by design today (P0-9): a bundle re-signed with a new identity passes', () => {
    // Documents the current trust gap fixed in T2.13: the verifying key comes
    // from the same bundle, so a server can swap identity + SPK together.
    const attacker = nacl.sign.keyPair();
    expect(() => verifySignedPreKeyBundle(bundleFor(attacker))).not.toThrow();
  });
});

describe('computeSafetyNumber', () => {
  it('is symmetric and formatted as 6 groups of 5 hex digits', () => {
    const a = encodeBase64(nacl.sign.keyPair().publicKey);
    const b = encodeBase64(nacl.sign.keyPair().publicKey);
    const ab = computeSafetyNumber({ myIdentitySignPub: a, theirIdentitySignPub: b });
    const ba = computeSafetyNumber({ myIdentitySignPub: b, theirIdentitySignPub: a });
    expect(ab).toEqual(ba);
    expect(ab.displayCode).toMatch(/^([0-9A-F]{5} ){5}[0-9A-F]{5}$/);
    expect(ab.fingerprintHex).toHaveLength(64);
  });

  it('changes when either key changes', () => {
    const a = encodeBase64(nacl.sign.keyPair().publicKey);
    const b = encodeBase64(nacl.sign.keyPair().publicKey);
    const c = encodeBase64(nacl.sign.keyPair().publicKey);
    expect(computeSafetyNumber({ myIdentitySignPub: a, theirIdentitySignPub: b }).displayCode).not.toBe(
      computeSafetyNumber({ myIdentitySignPub: a, theirIdentitySignPub: c }).displayCode,
    );
  });
});
