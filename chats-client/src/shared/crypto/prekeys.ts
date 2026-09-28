import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64 } from 'tweetnacl-util';
import {
  rotateSignedPreKeySet,
  selectSignedPreKey,
  signSignedPreKey,
  type SignedPreKeyRecord,
  type SignedPreKeySet,
} from '@velo/protocol';

import { keysApi } from '../api/keys.api';
import { getIdentitySecretKeyBytesForUser } from './identityKeys';
import { storeOneTimePreKeySecret } from '../storage/oneTimePreKeys';
import { computeTopUpCount, isTopUpCheckDue } from './prekeyPolicy';

function signedPreKeyService(userId: string) {
  return `signed-prekey:${userId}`;
}

/**
 * The stored signed-prekey set (T2.10): the current key plus retained
 * previous ones. A pre-T2.10 record (a single key without `v`) is treated
 * as absent: its signature format is no longer accepted, and sessions that
 * used it copied the pair at creation, so nothing existing breaks.
 */
async function loadSignedPreKeySet(userId: string): Promise<SignedPreKeySet | null> {
  const creds = await Keychain.getGenericPassword({ service: signedPreKeyService(userId) });
  if (!creds) return null;
  try {
    const parsed = JSON.parse(creds.password) as Partial<SignedPreKeySet>;
    return parsed && parsed.v === 2 && parsed.current ? (parsed as SignedPreKeySet) : null;
  } catch {
    return null;
  }
}

async function saveSignedPreKeySet(userId: string, set: SignedPreKeySet) {
  await Keychain.setGenericPassword('signed-prekey', JSON.stringify(set), {
    service: signedPreKeyService(userId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Ensures a current signed prekey exists locally and on the server, rotating
 * it when it is 7 days old and retaining previous keys for 30 days (T2.10).
 * Idempotent: safe on every login / hydrate.
 */
export async function ensureSignedPreKeyForUser(myUserId: string, now: number = Date.now()): Promise<{ rotated: boolean; keyId: number }> {
  const identitySk = await getIdentitySecretKeyBytesForUser(myUserId);
  const generate = (createdAt: number): SignedPreKeyRecord => {
    const kp = nacl.box.keyPair(); // X25519
    // Key ids are u32 on the wire and must increase: seconds since 2020-01-01.
    const keyId = Math.max(1, Math.floor((createdAt - Date.UTC(2020, 0, 1)) / 1000));
    const publicKey = encodeBase64(kp.publicKey);
    return { keyId, publicKey, privateKey: encodeBase64(kp.secretKey), signature: signSignedPreKey(identitySk, keyId, publicKey), createdAt };
  };

  const existing = await loadSignedPreKeySet(myUserId);
  const { set, rotated } = rotateSignedPreKeySet(existing, now, generate);
  if (rotated || !existing) await saveSignedPreKeySet(myUserId, set);
  else if (set.previous.length !== existing.previous.length) await saveSignedPreKeySet(myUserId, set); // expired ones dropped

  // Upload (upsert) the current key; the server keeps the last few.
  await keysApi.uploadSignedPreKey({ keyId: set.current.keyId, publicKey: set.current.publicKey, signature: set.current.signature });
  return { rotated, keyId: set.current.keyId };
}

/**
 * The pair an initPacket names, if it is the current key or a retained one
 * younger than 30 days; otherwise a typed SESSION_RESET_REQUIRED.
 */
export async function getSignedPreKeyPairForKeyId(
  myUserId: string,
  keyId: number,
  now: number = Date.now(),
): Promise<{ keyId: number; publicKey: string; privateKey: string }> {
  const set = await loadSignedPreKeySet(myUserId);
  const found = selectSignedPreKey(set, keyId, now);
  return { keyId: found.keyId, publicKey: found.publicKey, privateKey: found.privateKey };
}

/**
 * Generates a batch of one-time prekeys, stores secret keys locally,
 * uploads public keys to server. Safe to call multiple times:
 * server ignores duplicates (upsert/insertMany ordered:false).
 */
export async function uploadOneTimePreKeysBatch(params: {
  myUserId: string;
  count: number; // e.g. 50
  startKeyId?: number; // optional for deterministic ids
}): Promise<void> {
  const start = params.startKeyId ?? Date.now();

  const items: Array<{ keyId: number; publicKey: string }> = [];
  for (let i = 0; i < params.count; i++) {
    const keyId = start + i;
    const kp = nacl.box.keyPair(); // X25519

    const pub = encodeBase64(kp.publicKey);
    const sk = encodeBase64(kp.secretKey);

    // store secret locally (needed later to respond to X3DH init)
    await storeOneTimePreKeySecret({
      myUserId: params.myUserId,
      keyId,
      secretKeyBase64: sk,
    });

    items.push({ keyId, publicKey: pub });
  }

  await keysApi.uploadOneTimePreKeys(items);
}

let topUpInFlight: Promise<void> | null = null;
let lastTopUpCheckAt = 0;

/**
 * Asks the server how many unused one-time prekeys remain and uploads a fresh
 * batch when the pool is below the minimum (see prekeyPolicy.ts).
 *
 * Safe to call often: concurrent callers share one in-flight request, and
 * without `force` a check runs at most once per TOP_UP_CHECK_INTERVAL_MS.
 * Network failures are logged, never thrown — a top-up must not block login
 * or chat.
 */
export async function topUpOneTimePreKeysIfNeeded(
  myUserId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (topUpInFlight) return topUpInFlight;
  if (!opts.force && !isTopUpCheckDue(lastTopUpCheckAt, Date.now())) return;

  topUpInFlight = (async () => {
    try {
      const res = await keysApi.getUnusedOneTimePreKeysCount();
      lastTopUpCheckAt = Date.now();
      const need = computeTopUpCount(res.data.unused);
      if (need > 0) {
        await uploadOneTimePreKeysBatch({ myUserId, count: need });
      }
    } catch (e) {
      console.warn('[prekeys] top-up failed:', (e as Error)?.message ?? e);
    } finally {
      topUpInFlight = null;
    }
  })();

  return topUpInFlight;
}

/**
 * Login/hydrate bootstrap: ensure the signed prekey exists (rotating when
 * due) and is uploaded, then top up the one-time pool unconditionally.
 */
export async function ensurePreKeysForUser(myUserId: string): Promise<void> {
  await ensureSignedPreKeyForUser(myUserId);
  await topUpOneTimePreKeysIfNeeded(myUserId, { force: true });
}
