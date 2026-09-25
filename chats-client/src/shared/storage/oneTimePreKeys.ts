import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { looksSealed, openJson, sealJson } from './sealed';

function key(myUserId: string, preKeyId: number) {
  return `otpk:${myUserId}:${preKeyId}`; // one-time prekey secret
}

/**
 * One-time prekey secrets, sealed under the session master key (T1.3).
 * A pre-T1.3 plaintext secret is migrated in place on first read so that
 * bundles the server has already issued against it still resolve.
 */
export async function storeOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
  secretKeyBase64: string;
}) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  await AsyncStorage.setItem(key(params.myUserId, params.keyId), sealJson(mk, params.secretKeyBase64));
}

export async function getOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
}): Promise<string | null> {
  const storageKey = key(params.myUserId, params.keyId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  if (looksSealed(raw)) {
    const secret = openJson<string>(mk, raw);
    return typeof secret === 'string' ? secret : null;
  }

  // Legacy plaintext base64 secret → migrate in place.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
  await AsyncStorage.setItem(storageKey, sealJson(mk, raw));
  return raw;
}

export async function deleteOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
}) {
  await AsyncStorage.removeItem(key(params.myUserId, params.keyId));
}
