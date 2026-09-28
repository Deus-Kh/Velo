import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import type { RatchetSessionV2 } from '../types/session';
import { kdfRootKey } from './root';

/** X25519 pair as base64; injectable so tests can pin the session bytes. */
export interface DhKeyPairB64 {
  publicKey: string;
  privateKey: string;
}

function requireKey(b64: string, what: string): Uint8Array {
  const bytes = decodeBase64(normalizeB64(b64));
  if (bytes.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', what + ' must be 32 bytes', { what, length: bytes.length });
  }
  return bytes;
}

function freshPair(): DhKeyPairB64 {
  const kp = nacl.box.keyPair();
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
}

/**
 * Initiator initialisation (spec §8.1, Signal's initialize_alice_session):
 *   RK := SK; DHs := fresh; DHr := SPK_B; (RK, CKs) := KDF_RK(RK, DH(DHs, DHr)); CKr := null.
 * The initiator therefore performs the first ratchet step at creation and
 * its first message already carries a fresh ratchet key.
 * Pure: no storage, no clock. `dhs` is injectable for vector tests only.
 */
export function initInitiatorSession(params: {
  peerUserId: string;
  sharedSecret: string; // base64 32 bytes, the X3DH root key
  theirSignedPreKeyPublicKey: string; // base64 X25519, SPK_B
  dhs?: DhKeyPairB64;
}): RatchetSessionV2 {
  const sk = requireKey(params.sharedSecret, 'sharedSecret');
  const dhs = params.dhs ?? freshPair();
  const dhsPriv = requireKey(dhs.privateKey, 'DHsPrivateKey');
  const dhr = requireKey(params.theirSignedPreKeyPublicKey, 'theirSignedPreKeyPublicKey');

  const { newRootKey, newChainKey } = kdfRootKey({ rootKey: sk, dhOut: nacl.scalarMult(dhsPriv, dhr) });

  return {
    v: 2,
    protoVersion: 3,
    peerUserId: params.peerUserId,
    rootKey: encodeBase64(newRootKey),
    chainKeySend: encodeBase64(newChainKey),
    chainKeyRecv: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: {},
    skippedEpochOrder: [normalizeB64(params.theirSignedPreKeyPublicKey)],
    peerEpochHistory: [normalizeB64(params.theirSignedPreKeyPublicKey)],
    DHsPublicKey: dhs.publicKey,
    DHsPrivateKey: dhs.privateKey,
    DHrPublicKey: normalizeB64(params.theirSignedPreKeyPublicKey),
  };
}

/**
 * Responder initialisation (spec §8.1, Signal's initialize_bob_session):
 *   RK := SK; DHs := SPK_B pair (copied into the session); DHr := null; CKs := CKr := null.
 * The first inbound message performs a full ratchet step (R13), which
 * creates both chains. The signed-prekey pair is copied, so a later
 * signed-prekey rotation cannot break this session.
 */
export function initResponderSession(params: {
  peerUserId: string;
  sharedSecret: string; // base64 32 bytes, the X3DH root key
  signedPreKey: DhKeyPairB64; // our SPK pair the initiator used
}): RatchetSessionV2 {
  requireKey(params.sharedSecret, 'sharedSecret');
  requireKey(params.signedPreKey.privateKey, 'signedPreKey.privateKey');
  requireKey(params.signedPreKey.publicKey, 'signedPreKey.publicKey');

  return {
    v: 2,
    protoVersion: 3,
    peerUserId: params.peerUserId,
    rootKey: normalizeB64(params.sharedSecret),
    chainKeySend: null,
    chainKeyRecv: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: {},
    skippedEpochOrder: [],
    peerEpochHistory: [],
    DHsPublicKey: normalizeB64(params.signedPreKey.publicKey),
    DHsPrivateKey: normalizeB64(params.signedPreKey.privateKey),
    DHrPublicKey: null,
  };
}
