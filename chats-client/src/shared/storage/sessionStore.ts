import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnySession, RatchetSessionV2 } from '@velo/protocol';
import { initInitiatorSession, initResponderSession } from '@velo/protocol';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { looksSealed, openJson, sealJson } from './sealed';

function sessionKey(myUserId: string, peerUserId: string) {
  return `session:v2:${myUserId}:${peerUserId}`;
}

/**
 * Only the T2.0 format (`v: 2`, standard bootstrap) is loadable. A `v: 1`
 * session used the HKDF directional split and never ratcheted; it is
 * discarded so the pair re-bootstraps on the next message.
 */
function isSessionShape(value: unknown): value is AnySession {
  const s = value as Partial<RatchetSessionV2> | null;
  const keyOrNull = (k: unknown) => k === null || typeof k === 'string';
  return (
    !!s &&
    typeof s === 'object' &&
    s.v === 2 &&
    s.protoVersion === 2 &&
    typeof s.rootKey === 'string' &&
    keyOrNull(s.chainKeySend) &&
    keyOrNull(s.chainKeyRecv) &&
    typeof s.DHsPublicKey === 'string' &&
    typeof s.DHsPrivateKey === 'string' &&
    keyOrNull(s.DHrPublicKey) &&
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
    // Wrong key, tampered blob or a pre-T2.0 format → no session. A stale
    // format is removed so the next message re-bootstraps cleanly.
    if (session && isSessionShape(session)) return session;
    if (session) await AsyncStorage.removeItem(storageKey);
    return null;
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
 * Create and persist the initiator's session (T2.0, spec §8.1). The
 * session bytes come from the pure initialiser in @velo/protocol; this
 * wrapper only saves the result.
 */
export async function createInitiatorSession(params: {
  myUserId: string;
  peerUserId: string;
  sharedSecret: string; // base64, X3DH root key
  theirSignedPreKeyPublicKey: string; // base64, SPK_B from the bundle
}): Promise<RatchetSessionV2> {
  const session = initInitiatorSession({
    peerUserId: params.peerUserId,
    sharedSecret: params.sharedSecret,
    theirSignedPreKeyPublicKey: params.theirSignedPreKeyPublicKey,
  });
  await saveSession({ myUserId: params.myUserId, peerUserId: params.peerUserId, session });
  return session;
}

/**
 * Create and persist the responder's session (T2.0). The signed-prekey
 * pair is copied into the session so a later rotation cannot break it.
 */
export async function createResponderSession(params: {
  myUserId: string;
  peerUserId: string;
  sharedSecret: string; // base64, X3DH root key
  signedPreKey: { publicKey: string; privateKey: string };
}): Promise<RatchetSessionV2> {
  const session = initResponderSession({
    peerUserId: params.peerUserId,
    sharedSecret: params.sharedSecret,
    signedPreKey: params.signedPreKey,
  });
  await saveSession({ myUserId: params.myUserId, peerUserId: params.peerUserId, session });
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
