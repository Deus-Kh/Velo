import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnySession, RatchetSessionV2 } from '@velo/protocol';
import { createSessionFromX3DH as buildSessionFromX3DH } from '@velo/protocol';
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
 * Create and persist a new v2 session from X3DH-derived keys.
 *
 * The session bytes come from the pure builder in @velo/protocol (T2.1);
 * this wrapper only resolves the initiator rule and saves the result.
 * When `isInitiator` is omitted a deterministic user-id comparison is used
 * so both peers agree without extra messages.
 */
export async function createSessionFromX3DH(params: {
  myUserId: string;
  peerUserId: string;
  rootKey: string;  // base64
  chainKey: string; // base64 (single X3DH chain key)
  isInitiator?: boolean;
}): Promise<RatchetSessionV2> {
  const isInitiator =
    typeof params.isInitiator === 'boolean'
      ? params.isInitiator
      : String(params.myUserId) < String(params.peerUserId);

  const session = buildSessionFromX3DH({
    peerUserId: params.peerUserId,
    rootKey: params.rootKey,
    chainKey: params.chainKey,
    isInitiator,
  });

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
