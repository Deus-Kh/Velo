import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { hkdfSha256 } from '../primitives/kdf';
import type { RatchetSessionV2 } from '../types/session';

/** X25519 pair as base64; injectable so tests can pin the session bytes. */
export interface DhKeyPairB64 {
  publicKey: string;
  privateKey: string;
}

/** "chainKeyDir" — HKDF info for the directional split. Wire-format constant (R8). */
const CHAIN_KEY_DIR_INFO = new Uint8Array([99, 104, 97, 105, 110, 75, 101, 121, 68, 105, 114]);

/**
 * Build a fresh v2 session from X3DH output. Pure: no storage, no clock.
 * Persistence is the client's job (storage/sessionStore.ts).
 *
 * X3DH yields one chain key; it is expanded into two directional keys and
 * mirrored by `isInitiator` so both peers agree without extra messages.
 *
 * NOTE (P1-0 / T2.0): this HKDF directional split is not the standard Double
 * Ratchet bootstrap and is the reason the DH ratchet never fires today. T2.0
 * replaces it; do not build on it. T2.1 moved it here unchanged.
 */
export function createSessionFromX3DH(params: {
  peerUserId: string;
  rootKey: string; // base64
  chainKey: string; // base64, single X3DH chain key
  isInitiator: boolean;
  dhs?: DhKeyPairB64;
}): RatchetSessionV2 {
  const chainKeyBytes = decodeBase64(params.chainKey);
  if (chainKeyBytes.length !== 32) {
    throw new Error(`createSessionFromX3DH: chainKey must be 32 bytes, got ${chainKeyBytes.length}`);
  }

  const expanded = hkdfSha256({
    ikm: chainKeyBytes,
    salt: new Uint8Array(32),
    info: CHAIN_KEY_DIR_INFO,
    length: 64,
  });
  const k0 = expanded.slice(0, 32);
  const k1 = expanded.slice(32, 64);

  // initiator: send=k0, recv=k1 · responder: send=k1, recv=k0
  const chainKeySendBytes = params.isInitiator ? k0 : k1;
  const chainKeyRecvBytes = params.isInitiator ? k1 : k0;

  let dhs = params.dhs;
  if (!dhs) {
    const pair = nacl.box.keyPair();
    dhs = { publicKey: encodeBase64(pair.publicKey), privateKey: encodeBase64(pair.secretKey) };
  }

  return {
    v: 1,
    protoVersion: 2,
    peerUserId: params.peerUserId,

    rootKey: params.rootKey,
    chainKeySend: encodeBase64(chainKeySendBytes),
    chainKeyRecv: encodeBase64(chainKeyRecvBytes),

    Ns: 0,
    Nr: 0,
    PN: 0,

    skippedKeys: {},

    DHsPublicKey: dhs.publicKey,
    DHsPrivateKey: dhs.privateKey,

    // Left null; set when the first v2 header.dhPub is seen (see P1-0).
    DHrPublicKey: null,
  };
}
