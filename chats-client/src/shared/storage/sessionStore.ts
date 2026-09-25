import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import type { AnySession, RatchetSessionV2 } from '../crypto/sessionTypes';
import { hkdfSha256 } from '../crypto/kdf';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { looksSealed, openJson, sealJson } from './sealed';

function sessionKey(myUserId: string, peerUserId: string) {
  return `session:v2:${myUserId}:${peerUserId}`;
}

function isSessionShape(value: unknown): value is AnySession {
  const s = value as Partial<RatchetSessionV2> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    s.protoVersion === 2 &&
    typeof s.rootKey === 'string' &&
    typeof s.chainKeySend === 'string' &&
    typeof s.chainKeyRecv === 'string' &&
    typeof s.Ns === 'number' &&
    typeof s.Nr === 'number'
  );
}

/**
 * Loads the session for (me, peer). Session state is sealed under the
 * session master key (T1.3). A pre-T1.3 plaintext session is migrated in
 * place on first load: the plaintext bytes have already been on disk, so
 * re-sealing does not undo that exposure, but discarding the session would
 * break every existing conversation until re-bootstrap (T2.11) exists.
 */
export async function loadSession(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<AnySession | null> {
  const storageKey = sessionKey(params.myUserId, params.peerUserId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  const mk = await getOrCreateSessionMasterKey(params.myUserId);

  if (looksSealed(raw)) {
    const session = openJson<AnySession>(mk, raw);
    // Wrong key or tampered blob → treat as no session; the UI offers a reset.
    return session && isSessionShape(session) ? session : null;
  }

  // Legacy plaintext (pre-T1.3): migrate in place.
  let legacy: unknown;
  try {
    legacy = JSON.parse(raw);
  } catch {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
  if (!isSessionShape(legacy)) {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
  await AsyncStorage.setItem(storageKey, sealJson(mk, legacy));
  return legacy;
}

export async function saveSession(params: {
  myUserId: string;
  peerUserId: string;
  session: AnySession;
}): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  await AsyncStorage.setItem(
    sessionKey(params.myUserId, params.peerUserId),
    sealJson(mk, params.session),
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
 *
 * NOTE (P1-0 / T2.0): this HKDF directional split is not the standard Double
 * Ratchet bootstrap and is the reason the DH ratchet never fires today. T2.0
 * replaces it; do not build on it.
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
 */
export async function deleteAllSessionsForUser(myUserId: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `session:v2:${myUserId}:`;
  const toRemove = allKeys.filter((k) => k.startsWith(prefix));
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}
