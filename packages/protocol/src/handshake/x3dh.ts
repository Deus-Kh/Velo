import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { hkdfSha256 } from '../primitives/kdf';
import { ProtocolError } from '../errors';
import { wipe } from '../primitives/zeroize';
import { verifySignedPreKeyBundle } from './bundle';
import { verifyIdentityBinding } from '../identity/binding';
import type { PreKeyBundle } from './types';

/** "WhisperText" — Signal's X3DH HKDF info label (libsignal derive_keys). Wire constant (R8). */
export const INFO_X3DH = new Uint8Array([87, 104, 105, 115, 112, 101, 114, 84, 101, 120, 116]);

/** Signal's discontinuity prefix: 32 bytes of 0xFF ahead of the DH outputs. */
const X3DH_PREFIX = new Uint8Array(32).fill(0xff);

export type X3DHInitPacket = {
  peerUserId: string;
  ephPublicKey: string; // base64 X25519
  signedPreKeyId: number;
  oneTimePreKeyId: number | null;
  initiatorIdentityDhPublicKey: string; // base64 X25519
  /** T3.5 PQ-readiness (PQXDH shape): which KEM prekey was encapsulated to, and the ciphertext. Absent today. */
  pqPreKeyId?: number | null;
  kemCiphertext?: string | null; // base64
};

/** ML-KEM shared secrets are 32 bytes for every parameter set. */
export const KEM_SHARED_SECRET_LENGTH = 32;

export type X3DHSessionKeys = {
  rootKey: string; // base64 32 bytes — the shared secret SK the ratchet starts from
  chainKey: string; // base64 32 bytes — libsignal's second output; unused by the standard bootstrap
  /** T3.6 header encryption: the initiator's first sending header key (shared_hka in the Double Ratchet spec). */
  headerKeyA: string; // base64 32 bytes
  /** T3.6: the responder's first next-header key (shared_nhkb). */
  nextHeaderKeyB: string; // base64 32 bytes
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

function key(b64: string, what: string): Uint8Array {
  const bytes = decodeBase64(b64);
  requireLength(bytes, 32, what);
  return bytes;
}

/**
 * Signal's X3DH key derivation:
 *   IKM := 0xFF×32 ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4] [‖ SS_KEM]
 *   HKDF-SHA256(salt = none, IKM, info = "WhisperText", 128) → SK ‖ chainKey ‖ HK_A ‖ NHK_B
 * The first 64 bytes are byte-identical to libsignal for the T2.15 vectors
 * (HKDF expansion is prefix-stable); the next 64 are the header-encryption
 * seeds of T3.6 (shared_hka, shared_nhkb). The optional trailing
 * KEM shared secret is PQXDH's extension point (T3.5): with it the IKM is
 * exactly PQXDH's `F || DH1..DH4 || SS`; without it nothing changes.
 */
function deriveSessionKeys(dhParts: Uint8Array[], kemSharedSecret?: Uint8Array | null): X3DHSessionKeys {
  const parts = [...dhParts];
  if (kemSharedSecret) {
    requireLength(kemSharedSecret, KEM_SHARED_SECRET_LENGTH, 'kemSharedSecret');
    parts.push(kemSharedSecret);
  }
  const ikm = concatBytes([X3DH_PREFIX, ...parts]);
  wipe(...parts);
  const okm = hkdfSha256({ ikm, info: INFO_X3DH, length: 128 });
  wipe(ikm);
  const out = {
    rootKey: encodeBase64(okm.slice(0, 32)),
    chainKey: encodeBase64(okm.slice(32, 64)),
    headerKeyA: encodeBase64(okm.slice(64, 96)),
    nextHeaderKeyB: encodeBase64(okm.slice(96, 128)),
  };
  wipe(okm); // T3.4: DH outputs, IKM and the HKDF block are all zeroed
  return out;
}

/**
 * Initiator side of X3DH (spec T2.9, Signal's order):
 *   DH1 = DH(IK_A, SPK_B)   identity of A ↔ signed prekey of B
 *   DH2 = DH(EK_A, IK_B)    ephemeral of A ↔ identity of B   (the fourth DH, P1-5)
 *   DH3 = DH(EK_A, SPK_B)
 *   DH4 = DH(EK_A, OPK_B)   when a one-time prekey was issued
 * The bundle's signed-prekey signature and identity binding are verified
 * here so the pure core never trusts an unverified bundle. Comparing the
 * identity with the pin is the caller's job (identity/trust.ts).
 * Pure; `ephemeral` is injectable for frozen-vector tests only.
 */
export function x3dhInitiate(params: {
  bundle: PreKeyBundle;
  peerUserId: string;
  identityDhPublicKey: string; // base64, ours (IK_A)
  identityDhSecretKey: Uint8Array; // ours
  ephemeral?: nacl.BoxKeyPair;
  /** T3.5: the KEM shared secret obtained by encapsulating to `bundle.pqPreKey` (PQXDH). Never supplied today. */
  kemSharedSecret?: Uint8Array | null;
}): { initPacket: X3DHInitPacket; sessionKeys: X3DHSessionKeys; theirSignedPreKeyPublicKey: string } {
  const { bundle } = params;
  verifySignedPreKeyBundle(bundle);
  verifyIdentityBinding(bundle);
  requireLength(params.identityDhSecretKey, 32, 'identityDhSecretKey');

  const eph = params.ephemeral ?? nacl.box.keyPair();
  const spkPub = key(bundle.signedPreKey.publicKey, 'signedPreKey.publicKey');
  const ikB = key(bundle.identityDhPublicKey, 'identityDhPublicKey');

  const dhParts: Uint8Array[] = [
    nacl.scalarMult(params.identityDhSecretKey, spkPub), // DH1
    nacl.scalarMult(eph.secretKey, ikB), // DH2
    nacl.scalarMult(eph.secretKey, spkPub), // DH3
  ];

  let oneTimePreKeyId: number | null = null;
  if (bundle.oneTimePreKey) {
    const opkPub = key(bundle.oneTimePreKey.publicKey, 'oneTimePreKey.publicKey');
    dhParts.push(nacl.scalarMult(eph.secretKey, opkPub)); // DH4
    oneTimePreKeyId = bundle.oneTimePreKey.keyId;
  }

  const sessionKeys = deriveSessionKeys(dhParts, params.kemSharedSecret);
  if (!params.ephemeral) wipe(eph.secretKey); // T3.4: the ephemeral secret is never needed again

  return {
    initPacket: {
      peerUserId: params.peerUserId,
      ephPublicKey: encodeBase64(eph.publicKey),
      signedPreKeyId: bundle.signedPreKey.keyId,
      oneTimePreKeyId,
      initiatorIdentityDhPublicKey: params.identityDhPublicKey,
    },
    sessionKeys,
    theirSignedPreKeyPublicKey: bundle.signedPreKey.publicKey,
  };
}

/**
 * Responder side. The caller looks up its signed-prekey secret, its identity
 * DH secret, and the one-time prekey secret named by the packet (deleting
 * the latter after this returns). The initiator's identity key in the
 * packet must already have been authenticated against the pin
 * (identity/trust.ts) — this function computes, it does not decide trust.
 */
export function x3dhRespond(params: {
  initPacket: X3DHInitPacket;
  signedPreKeySecretKey: Uint8Array;
  identityDhSecretKey: Uint8Array; // ours (IK_B)
  oneTimePreKeySecretKey: Uint8Array | null;
  /** T3.5: the KEM shared secret decapsulated from `initPacket.kemCiphertext` (PQXDH). Never supplied today. */
  kemSharedSecret?: Uint8Array | null;
}): X3DHSessionKeys {
  const { initPacket } = params;
  requireLength(params.signedPreKeySecretKey, 32, 'signedPreKeySecretKey');
  requireLength(params.identityDhSecretKey, 32, 'identityDhSecretKey');

  const ephPub = key(initPacket.ephPublicKey, 'initPacket.ephPublicKey');
  const ikA = key(initPacket.initiatorIdentityDhPublicKey, 'initPacket.initiatorIdentityDhPublicKey');

  const dhParts: Uint8Array[] = [
    nacl.scalarMult(params.signedPreKeySecretKey, ikA), // DH1
    nacl.scalarMult(params.identityDhSecretKey, ephPub), // DH2
    nacl.scalarMult(params.signedPreKeySecretKey, ephPub), // DH3
  ];

  if (initPacket.oneTimePreKeyId !== null) {
    if (!params.oneTimePreKeySecretKey) {
      throw new ProtocolError('SESSION_RESET_REQUIRED', 'One-time prekey secret not found locally (cannot complete X3DH)', {
        oneTimePreKeyId: initPacket.oneTimePreKeyId,
      });
    }
    requireLength(params.oneTimePreKeySecretKey, 32, 'oneTimePreKeySecretKey');
    dhParts.push(nacl.scalarMult(params.oneTimePreKeySecretKey, ephPub)); // DH4
  }

  return deriveSessionKeys(dhParts, params.kemSharedSecret);
}
