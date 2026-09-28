import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { isProtocolError, protocolErrorCode } from '../src/errors';
import type { PreKeyBundle } from '../src/handshake/types';
import { x3dhInitiate, x3dhRespond } from '../src/handshake/x3dh';
import { signIdentityBinding } from '../src/identity/binding';

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
      signature: encodeBase64(nacl.sign.detached(spkB.publicKey, ikSignB.secretKey)),
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

describe('x3dh (pure, current 3-DH construction pinned before T2.9/T2.13)', () => {
  it('initiator and responder derive the same keys, with and without a one-time prekey', () => {
    for (const withOpk of [true, false]) {
      const { initPacket, sessionKeys } = initiate(withOpk);
      const responded = x3dhRespond({
        initPacket,
        signedPreKeySecretKey: spkB.secretKey,
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

  it('is byte-for-byte the pre-T2.4 client output (frozen vectors, R8)', () => {
    const withOpk = initiate(true).sessionKeys;
    expect(hex(decodeBase64(withOpk.rootKey))).toBe('e2c88c6d127b8dcae727a1f67054b51e345404a69044ed04706d290681597d4e');
    expect(hex(decodeBase64(withOpk.chainKey))).toBe('a2a3abd47e0e42249bf4df455780fe3cd434353629e5e972b5eba24c2725bfb4');
    const noOpk = initiate(false).sessionKeys;
    expect(hex(decodeBase64(noOpk.rootKey))).toBe('84cf190f8e6f05df0c3af32b5d1e716ba5a932193acc0c875ada5d4241304015');
    expect(hex(decodeBase64(noOpk.chainKey))).toBe('e78b11e76ff22433a9db7b79065b396eb02f33d433ec8aa642a2b4355899ae7f');
  });

  it('the one-time prekey changes the result (DH2 is in the KDF input)', () => {
    expect(initiate(true).sessionKeys.rootKey).not.toBe(initiate(false).sessionKeys.rootKey);
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
      x3dhRespond({ initPacket, signedPreKeySecretKey: spkB.secretKey, oneTimePreKeySecretKey: null });
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
      x3dhRespond({ initPacket, signedPreKeySecretKey: new Uint8Array(16), oneTimePreKeySecretKey: null });
    } catch (e) {
      code = protocolErrorCode(e);
    }
    expect(code).toBe('INVALID_KEY_LENGTH');
  });
});
