import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { isProtocolError, protocolErrorCode } from '../src/errors';
import type { PreKeyBundle } from '../src/handshake/types';
import { x3dhInitiate, x3dhRespond } from '../src/handshake/x3dh';
import { signIdentityBinding } from '../src/identity/binding';
import { signSignedPreKey } from '../src/handshake/signedPrekey';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Fixed key material so the vectors are reproducible.
const ikSignB = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x11));
const ikDhA = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x22));
const spkB = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x33));
const opkB = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x44));
const ephA = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x55));
const ikDhB = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x66));

function bundle(withOpk: boolean): PreKeyBundle {
  return {
    userId: 'B',
    identitySignPublicKey: encodeBase64(ikSignB.publicKey),
    identityDhPublicKey: encodeBase64(ikDhB.publicKey),
    identityBindingSignature: signIdentityBinding(ikSignB.secretKey, encodeBase64(ikDhB.publicKey)),
    signedPreKey: {
      keyId: 7,
      publicKey: encodeBase64(spkB.publicKey),
      signature: signSignedPreKey(ikSignB.secretKey, 7, encodeBase64(spkB.publicKey)),
    },
    oneTimePreKey: withOpk ? { keyId: 9, publicKey: encodeBase64(opkB.publicKey) } : null,
  };
}

function initiate(withOpk: boolean) {
  return x3dhInitiate({
    bundle: bundle(withOpk),
    peerUserId: 'B',
    identityDhPublicKey: encodeBase64(ikDhA.publicKey),
    identityDhSecretKey: ikDhA.secretKey,
    ephemeral: ephA,
  });
}

describe('x3dh (pure, Signal\u2019s four-DH construction since T2.9)', () => {
  it('initiator and responder derive the same keys, with and without a one-time prekey', () => {
    for (const withOpk of [true, false]) {
      const { initPacket, sessionKeys } = initiate(withOpk);
      const responded = x3dhRespond({
        initPacket,
        signedPreKeySecretKey: spkB.secretKey,
        identityDhSecretKey: ikDhB.secretKey,
        oneTimePreKeySecretKey: withOpk ? opkB.secretKey : null,
      });
      expect(responded).toEqual(sessionKeys);
      expect(initPacket.oneTimePreKeyId).toBe(withOpk ? 9 : null);
      expect(initPacket.signedPreKeyId).toBe(7);
      expect(initPacket.peerUserId).toBe('B');
      expect(initPacket.ephPublicKey).toBe(encodeBase64(ephA.publicKey));
      expect(initPacket.initiatorIdentityDhPublicKey).toBe(encodeBase64(ikDhA.publicKey));
      expect(initiate(withOpk).theirSignedPreKeyPublicKey).toBe(encodeBase64(spkB.publicKey));
    }
  });

  it('is byte-for-byte reproducible for fixed keys (frozen vectors, R8; Signal constants since T2.9)', () => {
    const withOpk = initiate(true).sessionKeys;
    expect(hex(decodeBase64(withOpk.rootKey))).toBe('8b1b74dc1127d171059a3d7f6cd2090578107553f824657ec1fe87c05224a89d');
    expect(hex(decodeBase64(withOpk.chainKey))).toBe('d85de129709261e8161670fa0634ed55005bce907c736c0f81728b0adacc700a');
    const noOpk = initiate(false).sessionKeys;
    expect(hex(decodeBase64(noOpk.rootKey))).toBe('c8af857754a9fe0f788b206764f5aad98169a32d52eb010a55cb6bf2045ee7d6');
    expect(hex(decodeBase64(noOpk.chainKey))).toBe('72dda38984ae66abbb52e6ec1ba8f6cc1c94ecef6ca9f7da571a78e531c3932b');
  });

  it('the one-time prekey changes the result (DH4 is in the KDF input)', () => {
    expect(initiate(true).sessionKeys.rootKey).not.toBe(initiate(false).sessionKeys.rootKey);
  });

  it('the fourth DH binds the responder identity: a different IK_B secret on the responder side yields different keys', () => {
    const { initPacket, sessionKeys } = initiate(false);
    const other = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x77));
    const responded = x3dhRespond({ initPacket, signedPreKeySecretKey: spkB.secretKey, identityDhSecretKey: other.secretKey, oneTimePreKeySecretKey: null });
    expect(responded.rootKey).not.toBe(sessionKeys.rootKey);
  });

  it('rejects a bundle whose identity binding does not verify', () => {
    const forged = bundle(true);
    forged.identityDhPublicKey = encodeBase64(nacl.box.keyPair().publicKey); // DH key swapped, binding stale
    let code: string | null = null;
    try {
      x3dhInitiate({ bundle: forged, peerUserId: 'B', identityDhPublicKey: 'x', identityDhSecretKey: ikDhA.secretKey });
    } catch (e) {
      code = protocolErrorCode(e);
    }
    expect(code).toBe('IDENTITY_BINDING_INVALID');
  });

  it('rejects a bundle whose signed prekey is not signed by its identity key', () => {
    const forged = bundle(true);
    forged.identitySignPublicKey = encodeBase64(nacl.sign.keyPair().publicKey);
    let code: string | null = null;
    try {
      x3dhInitiate({ bundle: forged, peerUserId: 'B', identityDhPublicKey: 'x', identityDhSecretKey: ikDhA.secretKey });
    } catch (e) {
      expect(isProtocolError(e)).toBe(true);
      code = protocolErrorCode(e);
    }
    expect(code).toBe('IDENTITY_BINDING_INVALID');
  });

  it('a packet naming a one-time prekey whose secret is gone cannot be completed', () => {
    const { initPacket } = initiate(true);
    let code: string | null = null;
    try {
      x3dhRespond({ initPacket, signedPreKeySecretKey: spkB.secretKey, identityDhSecretKey: ikDhB.secretKey, oneTimePreKeySecretKey: null });
    } catch (e) {
      expect(isProtocolError(e)).toBe(true);
      code = protocolErrorCode(e);
    }
    expect(code).toBe('SESSION_RESET_REQUIRED');
  });

  it('rejects keys of the wrong length with a typed error', () => {
    const { initPacket } = initiate(false);
    let code: string | null = null;
    try {
      x3dhRespond({ initPacket, signedPreKeySecretKey: new Uint8Array(16), identityDhSecretKey: ikDhB.secretKey, oneTimePreKeySecretKey: null });
    } catch (e) {
      code = protocolErrorCode(e);
    }
    expect(code).toBe('INVALID_KEY_LENGTH');
  });
});
