import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import type { RatchetSessionV2 } from '../types/session';
import { kdfRootKey } from './root';
import { wipe } from '../primitives/zeroize';

/** True once the session has decrypted anything from the peer (a receiving chain exists). */
export function sessionHasReceived(session: RatchetSessionV2): boolean {
  return session.chainKeyRecv !== null;
}

/**
 * Glare tie-break (T2.11): when both sides bootstrapped at once, the lower
 * user id's session wins and the other side adopts it. Deterministic and
 * identical on both sides.
 */
export function glareWinner(myUserId: string, peerUserId: string): boolean {
  return String(myUserId) < String(peerUserId);
}

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
 * Initiator initialisation (spec §8.1, Signal's initialize_alice_session,
 * header-encryption variant RatchetInitAliceHE since T3.6):
 *   RK := SK; DHs := fresh; DHr := SPK_B; (RK, CKs, NHKs) := KDF_RK_HE(RK, DH(DHs, DHr)); CKr := null;
 *   HKs := shared_hka; HKr := null; NHKr := shared_nhkb.
 * The initiator therefore performs the first ratchet step at creation and
 * its first message already carries a fresh ratchet key.
 * Pure: no storage, no clock. `dhs` is injectable for vector tests only.
 */
export function initInitiatorSession(params: {
  peerUserId: string;
  sharedSecret: string; // base64 32 bytes, the X3DH root key
  headerKeyA: string; // base64 32 bytes, X3DH's shared_hka (T3.6)
  nextHeaderKeyB: string; // base64 32 bytes, X3DH's shared_nhkb (T3.6)
  theirSignedPreKeyPublicKey: string; // base64 X25519, SPK_B
  dhs?: DhKeyPairB64;
}): RatchetSessionV2 {
  const sk = requireKey(params.sharedSecret, 'sharedSecret');
  wipe(requireKey(params.headerKeyA, 'headerKeyA'));
  wipe(requireKey(params.nextHeaderKeyB, 'nextHeaderKeyB'));
  const dhs = params.dhs ?? freshPair();
  const dhsPriv = requireKey(dhs.privateKey, 'DHsPrivateKey');
  const dhr = requireKey(params.theirSignedPreKeyPublicKey, 'theirSignedPreKeyPublicKey');

  const dhOut = nacl.scalarMult(dhsPriv, dhr);
  wipe(dhsPriv);
  const { newRootKey, newChainKey, newHeaderKey } = kdfRootKey({ rootKey: sk, dhOut });
  wipe(sk, dhOut);
  const rootKey = encodeBase64(newRootKey);
  const chainKeySend = encodeBase64(newChainKey);
  const nextHeaderKeySend = encodeBase64(newHeaderKey);
  wipe(newRootKey, newChainKey, newHeaderKey); // T3.4

  return {
    v: 3,
    protoVersion: 3,
    peerUserId: params.peerUserId,
    rootKey,
    chainKeySend,
    chainKeyRecv: null,
    headerKeySend: normalizeB64(params.headerKeyA),
    headerKeyRecv: null,
    nextHeaderKeySend,
    nextHeaderKeyRecv: normalizeB64(params.nextHeaderKeyB),
    epochHeaderKeys: {},
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: {},
    skippedEpochOrder: [normalizeB64(params.theirSignedPreKeyPublicKey)],
    peerEpochHistory: [normalizeB64(params.theirSignedPreKeyPublicKey)],
    recentlyReceived: [],
    DHsPublicKey: dhs.publicKey,
    DHsPrivateKey: dhs.privateKey,
    DHrPublicKey: normalizeB64(params.theirSignedPreKeyPublicKey),
  };
}

/**
 * Responder initialisation (spec §8.1, Signal's initialize_bob_session,
 * RatchetInitBobHE since T3.6):
 *   RK := SK; DHs := SPK_B pair (copied into the session); DHr := null; CKs := CKr := null;
 *   HKs := null; NHKs := shared_nhkb; HKr := null; NHKr := shared_hka.
 * The first inbound message performs a full ratchet step (R13), which
 * creates both chains. The signed-prekey pair is copied, so a later
 * signed-prekey rotation cannot break this session.
 */
export function initResponderSession(params: {
  peerUserId: string;
  sharedSecret: string; // base64 32 bytes, the X3DH root key
  headerKeyA: string; // base64 32 bytes, X3DH's shared_hka (T3.6)
  nextHeaderKeyB: string; // base64 32 bytes, X3DH's shared_nhkb (T3.6)
  signedPreKey: DhKeyPairB64; // our SPK pair the initiator used
}): RatchetSessionV2 {
  wipe(requireKey(params.sharedSecret, 'sharedSecret'));
  wipe(requireKey(params.headerKeyA, 'headerKeyA'));
  wipe(requireKey(params.nextHeaderKeyB, 'nextHeaderKeyB'));
  wipe(requireKey(params.signedPreKey.privateKey, 'signedPreKey.privateKey'));
  requireKey(params.signedPreKey.publicKey, 'signedPreKey.publicKey');

  return {
    v: 3,
    protoVersion: 3,
    peerUserId: params.peerUserId,
    rootKey: normalizeB64(params.sharedSecret),
    chainKeySend: null,
    chainKeyRecv: null,
    headerKeySend: null,
    headerKeyRecv: null,
    nextHeaderKeySend: normalizeB64(params.nextHeaderKeyB),
    nextHeaderKeyRecv: normalizeB64(params.headerKeyA),
    epochHeaderKeys: {},
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: {},
    skippedEpochOrder: [],
    peerEpochHistory: [],
    recentlyReceived: [],
    DHsPublicKey: normalizeB64(params.signedPreKey.publicKey),
    DHsPrivateKey: normalizeB64(params.signedPreKey.privateKey),
    DHrPublicKey: null,
  };
}
