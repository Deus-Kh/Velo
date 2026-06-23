import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64,decodeBase64 } from 'tweetnacl-util';

import { keysApi } from '../api/keys.api';
import { getIdentitySecretKeyBytesForUser } from './identityKeys';
import { storeOneTimePreKeySecret } from '../storage/oneTimePreKeys';


type StoredSignedPreKey = {
  keyId: number;
  publicKey: string;   // base64
  privateKey: string;  // base64 (X25519 secretKey)
  signature: string;   // base64
};

function signedPreKeyService(userId: string) {
  return `signed-prekey:${userId}`;
}

async function getStoredSignedPreKey(userId: string): Promise<StoredSignedPreKey | null> {
  const creds = await Keychain.getGenericPassword({ service: signedPreKeyService(userId) });
  if (!creds) return null;
  return JSON.parse(creds.password) as StoredSignedPreKey;
}

async function saveSignedPreKey(userId: string, data: StoredSignedPreKey) {
  await Keychain.setGenericPassword('signed-prekey', JSON.stringify(data), {
    service: signedPreKeyService(userId),
  });
}

/**
 * Ensures signed prekey exists locally and is uploaded to server.
 * Idempotent: can be called on every login/hydrate.
 */
export async function ensureSignedPreKeyForUser(myUserId: string): Promise<void> {
  let spk = await getStoredSignedPreKey(myUserId);

  if (!spk) {
    const keyId = Date.now(); // simple unique increasing id
    const kp = nacl.box.keyPair(); // X25519

    const identitySk = await getIdentitySecretKeyBytesForUser(myUserId);
    const sigBytes = nacl.sign.detached(kp.publicKey, identitySk);

    spk = {
      keyId,
      publicKey: encodeBase64(kp.publicKey),
      privateKey: encodeBase64(kp.secretKey),
      signature: encodeBase64(sigBytes),
    };

    await saveSignedPreKey(myUserId, spk);
  }

  // upload (upsert on server)
  await keysApi.uploadSignedPreKey({
    keyId: spk.keyId,
    publicKey: spk.publicKey,
    signature: spk.signature,
  });
}

/**
 * Generates a batch of one-time prekeys, stores secret keys locally,
 * uploads public keys to server. Safe to call multiple times:
 * server ignores duplicates (upsert/insertMany ordered:false).
 */
export async function uploadOneTimePreKeysBatch(params: {
  myUserId: string;
  count: number;          // e.g. 50
  startKeyId?: number;    // optional for deterministic ids
}): Promise<void> {
  const start = params.startKeyId ?? Date.now();

  const items: Array<{ keyId: number; publicKey: string }> = [];
  const generatedKeyIds: number[] = [];
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
    generatedKeyIds.push(keyId);
  }

  await keysApi.uploadOneTimePreKeys(items);
}

/**
 * Simple strategy for now:
 * - ensure signed prekey
 * - upload N one-time prekeys each login (duplicates are ignored server-side)
 *
 * Later we’ll optimize: check remaining unused on server and top-up.
 */
export async function ensurePreKeysForUser(myUserId: string): Promise<void> {
  await ensureSignedPreKeyForUser(myUserId);

    const MIN_UNUSED = 30;
    const TARGET_UNUSED = 100;

   let unused = 0;
  try {
    const res = await keysApi.getUnusedOneTimePreKeysCount();
    unused = res.data.unused;
  } catch (e) {
    // если сервер недоступен — не блокируем логин/чат
    console.warn('Failed to fetch unused prekeys count:', e);
    return;
  }

  if (unused >= MIN_UNUSED) {
    return; // запас нормальный
  }

  const need = Math.min(TARGET_UNUSED - unused, 200); // safety cap
  if (need <= 0) return;

  await uploadOneTimePreKeysBatch({ myUserId, count: need });
}


export async function getSignedPreKeySecretBytesForUser(myUserId: string): Promise<Uint8Array> {
  const spk = await getStoredSignedPreKey(myUserId);
  if (!spk) throw new Error('Signed prekey not found locally');
  return decodeBase64(spk.privateKey); // X25519 secret key bytes
}