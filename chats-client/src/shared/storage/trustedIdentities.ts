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
 * A pin and a verification are different things (C2). The crypto path pins
 * silently on first contact; only the user's "Mark as verified", after
 * comparing the safety number, makes a contact verified. Record v3 carries
 * that decision as a `verified` flag inside the MAC, so the flag cannot be
 * flipped without the master key, and it is bound to the exact keys it was
 * given for. Any new pin (first contact, accepted key change) starts
 * unverified.
 *
 * Older records stay readable and load as unverified, because they cannot
 * say whether the user ever compared the number:
 * - v2 pins IK_sign and IK_dh;
 * - v1 pins IK_sign only (`identityDhPublicKey: null`); the identity binding
 *   proves the DH key belongs to the signing key, so the crypto path upgrades
 *   such a pin on the next verified contact.
 */

const MAC_DOMAIN_V1 = 'velo-trusted-identity-v1';
const MAC_DOMAIN_V2 = 'velo-trusted-identity-v2';
const MAC_DOMAIN_V3 = 'velo-trusted-identity-v3';

export interface TrustedIdentity {
  identitySignPublicKey: string;
  identityDhPublicKey: string | null;
}

/** A pin together with the user's verification decision for exactly those keys. */
export interface IdentityTrust {
  identity: TrustedIdentity;
  verified: boolean;
}

type PinParams = { myUserId: string; peerUserId: string };
type KeyParams = PinParams & { identitySignPublicKey: string; identityDhPublicKey: string };

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

interface TrustRecordV3 {
  v: 3;
  identitySignPublicKey: string;
  identityDhPublicKey: string;
  verified: boolean;
  mac: string;
}

const PREFIX = 'trusted-identity:';

function key(myUserId: string, peerUserId: string) {
  return `${PREFIX}${myUserId}:${peerUserId}`;
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

function isV3(value: unknown): value is TrustRecordV3 {
  const r = value as Partial<TrustRecordV3> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    r.v === 3 &&
    typeof r.identitySignPublicKey === 'string' &&
    typeof r.identityDhPublicKey === 'string' &&
    typeof r.verified === 'boolean' &&
    typeof r.mac === 'string'
  );
}

function v3Fields(p: KeyParams, verified: boolean): string[] {
  return [p.myUserId, p.peerUserId, p.identitySignPublicKey, p.identityDhPublicKey, verified ? 'verified' : 'unverified'];
}

async function writeV3(params: KeyParams, verified: boolean) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const record: TrustRecordV3 = {
    v: 3,
    identitySignPublicKey: params.identitySignPublicKey,
    identityDhPublicKey: params.identityDhPublicKey,
    verified,
    mac: macFor(mk, MAC_DOMAIN_V3, v3Fields(params, verified)),
  };
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(record));
}

async function writeV1(params: PinParams & { identitySignPublicKey: string }) {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const record: TrustRecordV1 = {
    v: 1,
    identitySignPublicKey: params.identitySignPublicKey,
    mac: macFor(mk, MAC_DOMAIN_V1, [params.myUserId, params.peerUserId, params.identitySignPublicKey]),
  };
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(record));
}

function rejected(peerUserId: string): null {
  console.warn('[trust] pin failed integrity check; ignoring', { peerUserId });
  return null;
}

/** The pin and its verification flag, or null when there is no pin or it fails its integrity check. */
export async function getIdentityTrust(params: PinParams): Promise<IdentityTrust | null> {
  const storageKey = key(params.myUserId, params.peerUserId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (isV3(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const keys = { ...params, identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: parsed.identityDhPublicKey };
    if (!verifyMac(mk, MAC_DOMAIN_V3, v3Fields(keys, parsed.verified), parsed.mac)) return rejected(params.peerUserId);
    return {
      identity: { identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: parsed.identityDhPublicKey },
      verified: parsed.verified,
    };
  }

  if (isV2(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const ok = verifyMac(mk, MAC_DOMAIN_V2, [params.myUserId, params.peerUserId, parsed.identitySignPublicKey, parsed.identityDhPublicKey], parsed.mac);
    if (!ok) return rejected(params.peerUserId);
    return { identity: { identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: parsed.identityDhPublicKey }, verified: false };
  }

  if (isV1(parsed)) {
    const mk = await getOrCreateSessionMasterKey(params.myUserId);
    const ok = verifyMac(mk, MAC_DOMAIN_V1, [params.myUserId, params.peerUserId, parsed.identitySignPublicKey], parsed.mac);
    if (!ok) return rejected(params.peerUserId);
    return { identity: { identitySignPublicKey: parsed.identitySignPublicKey, identityDhPublicKey: null }, verified: false };
  }

  // Legacy plaintext pin (pre-T1.3): a bare base64 key. Migrate in place to
  // an authenticated v1 record; like every old record it loads unverified.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    await writeV1({ myUserId: params.myUserId, peerUserId: params.peerUserId, identitySignPublicKey: raw });
    return { identity: { identitySignPublicKey: raw, identityDhPublicKey: null }, verified: false };
  }

  await AsyncStorage.removeItem(storageKey);
  return null;
}

/** The pinned keys only, as the crypto path needs them. */
export async function getTrustedIdentity(params: PinParams): Promise<TrustedIdentity | null> {
  return (await getIdentityTrust(params))?.identity ?? null;
}

/** True only when the user marked exactly the pinned keys as verified. */
export async function isIdentityVerified(params: PinParams): Promise<boolean> {
  return (await getIdentityTrust(params))?.verified ?? false;
}

/**
 * Pin both identity keys (T2.13). Callers verify the binding before pinning.
 * A new pin is never a verification: it is stored unverified.
 */
export async function setTrustedIdentity(params: KeyParams): Promise<void> {
  await writeV3(params, false);
}

/**
 * The user compared the safety number for these keys and confirmed it.
 * Pins the keys (replacing any older pin) and marks them verified.
 */
export async function markIdentityVerified(params: KeyParams): Promise<void> {
  await writeV3(params, true);
}

/** Withdraws the verification but keeps the pin, so the chat keeps working. */
export async function clearIdentityVerification(params: PinParams): Promise<void> {
  const trust = await getIdentityTrust(params);
  if (!trust || !trust.verified || trust.identity.identityDhPublicKey === null) return;
  await writeV3(
    { ...params, identitySignPublicKey: trust.identity.identitySignPublicKey, identityDhPublicKey: trust.identity.identityDhPublicKey },
    false,
  );
}

export async function clearTrustedIdentity(params: PinParams): Promise<void> {
  await AsyncStorage.removeItem(key(params.myUserId, params.peerUserId));
}

/** Peers whose pin is intact and marked verified by the user. */
export async function listVerifiedPeerUserIds(myUserId: string): Promise<string[]> {
  const prefix = `${PREFIX}${myUserId}:`;
  const peerUserIds = (await AsyncStorage.getAllKeys())
    .filter((storageKey) => storageKey.startsWith(prefix))
    .map((storageKey) => storageKey.slice(prefix.length))
    .filter(Boolean);
  const flags = await Promise.all(peerUserIds.map((peerUserId) => isIdentityVerified({ myUserId, peerUserId })));
  return peerUserIds.filter((_, i) => flags[i]);
}
