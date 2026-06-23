

import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import type { AnySession, RatchetSessionV2 } from '../crypto/sessionTypes';
import { hkdfSha256 } from '../crypto/kdf';

function sessionKey(myUserId: string, peerUserId: string) {
  return `session:v2:${myUserId}:${peerUserId}`;
}

export async function loadSession(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<AnySession | null> {
  const raw = await AsyncStorage.getItem(sessionKey(params.myUserId, params.peerUserId));
  if (!raw) return null;
  return JSON.parse(raw) as AnySession;
}

export async function saveSession(params: {
  myUserId: string;
  peerUserId: string;
  session: AnySession;
}): Promise<void> {
  await AsyncStorage.setItem(
    sessionKey(params.myUserId, params.peerUserId),
    JSON.stringify(params.session),
  );
}

export async function deleteSession(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<void> {
  await AsyncStorage.removeItem(sessionKey(params.myUserId, params.peerUserId));
}

/**
 * Create a new v2 session from X3DH-derived keys.
 * X3DH produces one chain key. We need to derive send and recv keys from it.
 *
 * IMPORTANT:
 * Send/recv MUST be mirrored between peers.
 * Use a deterministic "initiator" rule so both sides agree without extra messages.
 */
export async function createSessionFromX3DH(params: {
  myUserId: string;
  peerUserId: string;
  rootKey: string;  // base64
  chainKey: string; // base64 (initial - we'll expand this)
  isInitiator?: boolean;
}): Promise<RatchetSessionV2> {
  const chainKeyBytes = decodeBase64(params.chainKey);

  // Expand the X3DH chainKey into 2 directional keys (64 bytes total)
  const info = new Uint8Array([99, 104, 97, 105, 110, 75, 101, 121, 68, 105, 114]); // "chainKeyDir"
  const expanded = hkdfSha256({
    ikm: chainKeyBytes,
    salt: new Uint8Array(32),
    info,
    length: 64,
  });

  const k0 = expanded.slice(0, 32);
  const k1 = expanded.slice(32, 64);

  // Deterministic initiator rule (both sides must compute same boolean)
  const initiator =
    typeof params.isInitiator === 'boolean'
      ? params.isInitiator
      : String(params.myUserId) < String(params.peerUserId);

  // Mirror mapping:
  // - initiator: send=k0, recv=k1
  // - responder: send=k1, recv=k0
  const chainKeySendBytes = initiator ? k0 : k1;
  const chainKeyRecvBytes = initiator ? k1 : k0;

  const dhs = nacl.box.keyPair(); // X25519

  const session: RatchetSessionV2 = {
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

    DHsPublicKey: encodeBase64(dhs.publicKey),
    DHsPrivateKey: encodeBase64(dhs.secretKey),

    // IMPORTANT: leave null for now; it will be set when first v2 header.dhPub is seen
    // and applyDhRatchet/bootstrap logic runs in decryptV2.
    DHrPublicKey: null,
  };
  await saveSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session,
  });

  return session;
}

/**
 * Utility: delete all v2 sessions for this account.
 * (Used on logout if you want)
 */
export async function deleteAllSessionsForUser(myUserId: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `session:v2:${myUserId}:`;
  const toRemove = allKeys.filter((k) => k.startsWith(prefix));
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}
