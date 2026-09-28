import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { macFor, verifyMac } from './sealed';

/**
 * Trust-on-first-use pins (T1.3, extended by T2.13 to both identity keys).
 * Pins are not secret, but they must be tamper-evident: an unauthenticated
 * pin lets anything with AsyncStorage write access forge a "Verified" badge
 * or silently re-pin an attacker key. Each record carries an HMAC under the
 * session master key over (myUserId, peerUserId, keys); a record whose MAC
 * does not verify is treated as absent.
 *
 * Record v2 pins IK_sign and IK_dh. A v1 record (IK_sign only) is still
 * honoured with `identityDhPublicKey: null`; the identity binding proves the
 * DH key belongs to the signing key, so the crypto path upgrades such a pin
 * on the next verified contact.
 */

const MAC_DOMAIN_V1 = 'velo-trusted-identity-v1';
const MAC_DOMAIN_V2 = 'velo-trusted-identity-v2';

export interface TrustedIdentity {
  identitySignPublicKey: string;
  identityDhPublicKey: string | null;
}

interface TrustRecordV1 {
  v: 1;
  identitySignPublicKey: string;
  mac: string;
}

interface TrustRecordV2 {
  v: 2;
  identitySignPublicKey: string;
  identityDhPublicKey: string;
  mac: string;
}

function key(myUserId: string, peerUserId: string) {
  return `trusted-identity:${myUserId}:${peerUserId}`;
}

function isV1(value: unknown): value is TrustRecordV1 {
  const r = value as Partial<TrustRecordV1> | null;
  return !!r && typeof r === 'object' && r.v === 1 && typeof r.identitySignPublicKey === 'string' && typeof r.mac === 'string';
}

function isV2(value: unknown): value is TrustRecordV2 {
  const r = value as Partial<TrustRecordV2> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    r.v === 2 &&
    typeof r.identitySignPublicKey === 'string' &&
    typeof r.identityDhPublicKey === 'string' &&
    typeof r.mac === 'string'
  );
}

async function writeV2(params: { myUserId: string; peerUserId: string; identitySignPublicKey: string; identityDhPublicKey: string }) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const record: TrustRecordV2 = {
    v: 2,
    identitySignPublicKey: params.identitySignPublicKey,
    identityDhPublicKey: params.identityDhPublicKey,
    mac: macFor(mk, MAC_DOMAIN_V2, [params.myUserId, params.peerUserId, params.identitySignPublicKey, params.identityDhPublicKey]),
  };
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(record));
}

async function writeV1(params: { myUserId: string; peerUserId: string; identitySignPublicKey: string }) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const record: TrustRecordV1 = {
    v: 1,
    identitySignPublicKey: params.identitySignPublicKey,
    mac: macFor(mk, MAC_DOMAIN_V1, [params.myUserId, params.peerUserId, params.identitySignPublicKey]),
  };
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(record));
}

export async function getTrustedIdentity(params: { myUserId: string; peerUserId: string }): Promise<TrustedIdentity | null> {
  const storageKey = key(params.myUserId, params.peerUserId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (isV2(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const ok = verifyMac(mk, MAC_DOMAIN_V2, [params.myUserId, params.peerUserId, parsed.identitySignPublicKey, parsed.identityDhPublicKey], parsed.mac);
    if (!ok) {
      console.warn('[trust] pin failed integrity check; ignoring', { peerUserId: params.peerUserId });
      return null;
    }
    return { identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: parsed.identityDhPublicKey };
  }

  if (isV1(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const ok = verifyMac(mk, MAC_DOMAIN_V1, [params.myUserId, params.peerUserId, parsed.identitySignPublicKey], parsed.mac);
    if (!ok) {
      console.warn('[trust] pin failed integrity check; ignoring', { peerUserId: params.peerUserId });
      return null;
    }
    return { identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: null };
  }

  // Legacy plaintext pin (pre-T1.3): a bare base64 key. Migrate in place —
  // it is the user's own verification decision, not a secret.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    await writeV1({ myUserId: params.myUserId, peerUserId: params.peerUserId, identitySignPublicKey: raw });
    return { identitySignPublicKey: raw, identityDhPublicKey: null };
  }

  await AsyncStorage.removeItem(storageKey);
  return null;
}

/** Pin both identity keys (T2.13). Callers verify the binding before pinning. */
export async function setTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
  identitySignPublicKey: string;
  identityDhPublicKey: string;
}): Promise<void> {
  await writeV2(params);
}

export async function clearTrustedIdentity(params: { myUserId: string; peerUserId: string }): Promise<void> {
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
