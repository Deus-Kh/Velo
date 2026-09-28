import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { hkdfSha256 } from '../primitives/kdf';
import { ProtocolError } from '../errors';
import { verifySignedPreKeyBundle } from './bundle';
import { verifyIdentityBinding } from '../identity/binding';
import type { PreKeyBundle } from './types';

/** "x3dh-v1" — HKDF info for the handshake. Wire-format constant (R8). */
export const INFO_X3DH_V1 = new Uint8Array([120, 51, 100, 104, 45, 118, 49]);

export type X3DHInitPacket = {
  peerUserId: string;
  ephPublicKey: string; // base64 X25519
  signedPreKeyId: number;
  oneTimePreKeyId: number | null;
  initiatorIdentityDhPublicKey: string; // base64 X25519
};

export type X3DHSessionKeys = {
  rootKey: string; // base64 32 bytes
  chainKey: string; // base64 32 bytes
};

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function requireLength(bytes: Uint8Array, expected: number, what: string): void {
  if (bytes.length !== expected) {
    throw new ProtocolError('INVALID_KEY_LENGTH', what + ' must be ' + String(expected) + ' bytes', {
      what,
      length: bytes.length,
    });
  }
}

function deriveSessionKeys(dhParts: Uint8Array[]): X3DHSessionKeys {
  const okm = hkdfSha256({ ikm: concatBytes(dhParts), info: INFO_X3DH_V1, length: 64 });
  return { rootKey: encodeBase64(okm.slice(0, 32)), chainKey: encodeBase64(okm.slice(32, 64)) };
}

/**
 * Initiator side of the handshake. Pure: the caller fetched the bundle and
 * holds the identity DH secret; nothing here touches storage or network.
 *
 * Today's construction (pinned; T2.9 adds the fourth DH, T2.13 the identity
 * checks): DH1 = DH(EK_A, SPK_B), DH2 = DH(EK_A, OPK_B) when present,
 * DH3 = DH(IK_A, SPK_B). The bundle's signed-prekey signature and its
 * identity binding are verified here so the pure core never trusts an
 * unverified bundle (T2.13). Comparing the identity with the pin is the
 * caller's job (identity/trust.ts) because the pin lives in storage.
 *
 * `ephemeral` is injectable for frozen-vector tests only.
 */
export function x3dhInitiate(params: {
  bundle: PreKeyBundle;
  peerUserId: string;
  identityDhPublicKey: string; // base64, ours
  identityDhSecretKey: Uint8Array; // ours
  ephemeral?: nacl.BoxKeyPair;
}): { initPacket: X3DHInitPacket; sessionKeys: X3DHSessionKeys; theirSignedPreKeyPublicKey: string } {
  const { bundle } = params;
  verifySignedPreKeyBundle(bundle);
  verifyIdentityBinding(bundle);
  requireLength(params.identityDhSecretKey, 32, 'identityDhSecretKey');

  const eph = params.ephemeral ?? nacl.box.keyPair();
  const spkPub = decodeBase64(bundle.signedPreKey.publicKey);
  requireLength(spkPub, 32, 'signedPreKey.publicKey');

  const dhParts: Uint8Array[] = [nacl.scalarMult(eph.secretKey, spkPub)];

  let oneTimePreKeyId: number | null = null;
  if (bundle.oneTimePreKey) {
    const opkPub = decodeBase64(bundle.oneTimePreKey.publicKey);
    requireLength(opkPub, 32, 'oneTimePreKey.publicKey');
    dhParts.push(nacl.scalarMult(eph.secretKey, opkPub));
    oneTimePreKeyId = bundle.oneTimePreKey.keyId;
  }

  dhParts.push(nacl.scalarMult(params.identityDhSecretKey, spkPub));

  return {
    initPacket: {
      peerUserId: params.peerUserId,
      ephPublicKey: encodeBase64(eph.publicKey),
      signedPreKeyId: bundle.signedPreKey.keyId,
      oneTimePreKeyId,
      initiatorIdentityDhPublicKey: params.identityDhPublicKey,
    },
    sessionKeys: deriveSessionKeys(dhParts),
    theirSignedPreKeyPublicKey: bundle.signedPreKey.publicKey,
  };
}

/**
 * Responder side. Pure: the caller looks up the signed-prekey secret and the
 * one-time prekey secret named by the packet (and deletes the latter after
 * this returns). A packet that names a one-time prekey whose secret is gone
 * cannot be completed: the session must be re-established.
 */
export function x3dhRespond(params: {
  initPacket: X3DHInitPacket;
  signedPreKeySecretKey: Uint8Array;
  oneTimePreKeySecretKey: Uint8Array | null;
}): X3DHSessionKeys {
  const { initPacket } = params;
  requireLength(params.signedPreKeySecretKey, 32, 'signedPreKeySecretKey');

  const ephPub = decodeBase64(initPacket.ephPublicKey);
  requireLength(ephPub, 32, 'initPacket.ephPublicKey');

  const dhParts: Uint8Array[] = [nacl.scalarMult(params.signedPreKeySecretKey, ephPub)];

  if (initPacket.oneTimePreKeyId !== null) {
    if (!params.oneTimePreKeySecretKey) {
      throw new ProtocolError('SESSION_RESET_REQUIRED', 'One-time prekey secret not found locally (cannot complete X3DH)', {
        oneTimePreKeyId: initPacket.oneTimePreKeyId,
      });
    }
    requireLength(params.oneTimePreKeySecretKey, 32, 'oneTimePreKeySecretKey');
    dhParts.push(nacl.scalarMult(params.oneTimePreKeySecretKey, ephPub));
  }

  const initiatorIdentityDhPub = decodeBase64(initPacket.initiatorIdentityDhPublicKey);
  requireLength(initiatorIdentityDhPub, 32, 'initPacket.initiatorIdentityDhPublicKey');
  dhParts.push(nacl.scalarMult(params.signedPreKeySecretKey, initiatorIdentityDhPub));

  return deriveSessionKeys(dhParts);
}
