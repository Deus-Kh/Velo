import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { macFor, verifyMac } from './sealed';

/**
 * Trust-on-first-use pins (T1.3). Pins are not secret, but they must be
 * tamper-evident: an unauthenticated pin lets anything with AsyncStorage
 * write access forge a "Verified" badge or silently re-pin an attacker key.
 * Each record carries an HMAC under the session master key over
 * (myUserId, peerUserId, identitySignPublicKey); a record whose MAC does not
 * verify is treated as absent.
 */

const MAC_DOMAIN = 'velo-trusted-identity-v1';

interface TrustRecord {
  v: 1;
  identitySignPublicKey: string;
  mac: string;
}

function key(myUserId: string, peerUserId: string) {
  return `trusted-identity:${myUserId}:${peerUserId}`;
}

function isTrustRecord(value: unknown): value is TrustRecord {
  const r = value as Partial<TrustRecord> | null;
  return !!r && typeof r === 'object' && r.v === 1 && typeof r.identitySignPublicKey === 'string' && typeof r.mac === 'string';
}

async function writeRecord(params: { myUserId: string; peerUserId: string; identitySignPublicKey: string }) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const record: TrustRecord = {
    v: 1,
    identitySignPublicKey: params.identitySignPublicKey,
    mac: macFor(mk, MAC_DOMAIN, [params.myUserId, params.peerUserId, params.identitySignPublicKey]),
  };
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(record));
}

export async function getTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<string | null> {
  const storageKey = key(params.myUserId, params.peerUserId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (isTrustRecord(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const ok = verifyMac(mk, MAC_DOMAIN, [params.myUserId, params.peerUserId, parsed.identitySignPublicKey], parsed.mac);
    if (!ok) {
      console.warn('[trust] pin failed integrity check; ignoring', { peerUserId: params.peerUserId });
      return null;
    }
    return parsed.identitySignPublicKey;
  }

  // Legacy plaintext pin (pre-T1.3): a bare base64 key. Migrate in place —
  // it is the user's own verification decision, not a secret.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    await writeRecord({ myUserId: params.myUserId, peerUserId: params.peerUserId, identitySignPublicKey: raw });
    return raw;
  }

  await AsyncStorage.removeItem(storageKey);
  return null;
}

export async function setTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
  identitySignPublicKey: string;
}): Promise<void> {
  await writeRecord(params);
}

export async function clearTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<void> {
  await AsyncStorage.removeItem(key(params.myUserId, params.peerUserId));
}

export async function listTrustedPeerUserIds(myUserId: string): Promise<string[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `trusted-identity:${myUserId}:`;

  return allKeys
    .filter((storageKey) => storageKey.startsWith(prefix))
    .map((storageKey) => storageKey.slice(prefix.length))
    .filter(Boolean);
}
