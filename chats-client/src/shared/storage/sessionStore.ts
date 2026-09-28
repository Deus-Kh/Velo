import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnySession, RatchetSessionV2 } from '@velo/protocol';
import { initInitiatorSession, initResponderSession } from '@velo/protocol';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { looksSealed, openJson, sealJson } from './sealed';

function sessionKey(myUserId: string, peerUserId: string) {
  return `session:v2:${myUserId}:${peerUserId}`;
}

/** T2.11 glare: the peer's session kept for decryption only until the peer has switched to ours. */
function secondaryKey(myUserId: string, peerUserId: string) {
  return `session:v2:${myUserId}:${peerUserId}:secondary`;
}

/**
 * Only the T3.6 format (`v: 3`, header keys) is loadable. Anything older
 * (`v: 2` plaintext headers, `v: 1`) is discarded so the pair re-bootstraps
 * on the next message (spec §8.2: one bump, one migration).
 */
function isSessionShape(value: unknown): value is AnySession {
  const s = value as Partial<RatchetSessionV2> | null;
  const keyOrNull = (k: unknown) => k === null || typeof k === 'string';
  return (
    !!s &&
    typeof s === 'object' &&
    s.v === 3 &&
    s.protoVersion === 4 &&
    typeof s.nextHeaderKeySend === 'string' &&
    typeof s.nextHeaderKeyRecv === 'string' &&
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
  await AsyncStorage.multiRemove([sessionKey(params.myUserId, params.peerUserId), secondaryKey(params.myUserId, params.peerUserId)]);
}

export async function loadSecondarySession(params: { myUserId: string; peerUserId: string }): Promise<AnySession | null> {
  const raw = await AsyncStorage.getItem(secondaryKey(params.myUserId, params.peerUserId));
  if (!raw || !looksSealed(raw)) return null;
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const session = openJson<AnySession>(mk, raw);
  return session && isSessionShape(session) ? session : null;
}

export async function saveSecondarySession(params: { myUserId: string; peerUserId: string; session: AnySession }): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  await AsyncStorage.setItem(secondaryKey(params.myUserId, params.peerUserId), sealJson(mk, params.session));
}

export async function deleteSecondarySession(params: { myUserId: string; peerUserId: string }): Promise<void> {
  await AsyncStorage.removeItem(secondaryKey(params.myUserId, params.peerUserId));
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
  headerKeyA: string; // base64, X3DH shared_hka (T3.6)
  nextHeaderKeyB: string; // base64, X3DH shared_nhkb (T3.6)
  theirSignedPreKeyPublicKey: string; // base64, SPK_B from the bundle
}): Promise<RatchetSessionV2> {
  const session = initInitiatorSession({
    peerUserId: params.peerUserId,
    sharedSecret: params.sharedSecret,
    headerKeyA: params.headerKeyA,
    nextHeaderKeyB: params.nextHeaderKeyB,
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
  headerKeyA: string;
  nextHeaderKeyB: string;
  signedPreKey: { publicKey: string; privateKey: string };
}): Promise<RatchetSessionV2> {
  const session = initResponderSession({
    peerUserId: params.peerUserId,
    sharedSecret: params.sharedSecret,
    headerKeyA: params.headerKeyA,
    nextHeaderKeyB: params.nextHeaderKeyB,
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
