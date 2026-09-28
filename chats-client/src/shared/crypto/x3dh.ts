import { decodeBase64 } from 'tweetnacl-util';

import {
  x3dhInitiate as initiate,
  x3dhRespond as respond,
  type X3DHInitPacket,
  type X3DHSessionKeys,
} from '@velo/protocol';
import { fetchAndVerifyPreKeyBundle } from './prekeyBundle';
import { getSignedPreKeyPairForUser } from './prekeys';
import { getOneTimePreKeySecret, deleteOneTimePreKeySecret } from '../storage/oneTimePreKeys';
import { ensureIdentityDhKeyPairForUser, getIdentityDhSecretKeyBytesForUser } from './identityDhKeys';

export type { X3DHInitPacket, X3DHSessionKeys };

/**
 * I/O wrapper around the pure handshake in @velo/protocol (T2.4): fetches
 * the bundle, loads our identity DH secret, and hands both to the package.
 */
export async function x3dhInitiate(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<{ initPacket: X3DHInitPacket; sessionKeys: X3DHSessionKeys; theirSignedPreKeyPublicKey: string }> {
  const { myUserId, peerUserId } = params;

  const bundle = await fetchAndVerifyPreKeyBundle(myUserId, peerUserId);
  const identityDhPublicKey = await ensureIdentityDhKeyPairForUser(myUserId);
  const identityDhSecretKey = await getIdentityDhSecretKeyBytesForUser(myUserId);

  return initiate({ bundle, peerUserId, identityDhPublicKey, identityDhSecretKey });
}

/**
 * Responder wrapper: loads the signed-prekey pair and the named one-time
 * prekey secret, runs the pure handshake, then deletes the one-time secret.
 * Returns the signed-prekey pair too: the responder session copies it (T2.0).
 */
export async function x3dhRespond(params: {
  myUserId: string;
  initPacket: X3DHInitPacket;
}): Promise<{ sessionKeys: X3DHSessionKeys; signedPreKey: { publicKey: string; privateKey: string } }> {
  const { myUserId, initPacket } = params;

  const spk = await getSignedPreKeyPairForUser(myUserId);
  const signedPreKeySecretKey = decodeBase64(spk.privateKey);

  let oneTimePreKeySecretKey: Uint8Array | null = null;
  if (initPacket.oneTimePreKeyId !== null) {
    const skB64 = await getOneTimePreKeySecret({ myUserId, keyId: initPacket.oneTimePreKeyId });
    oneTimePreKeySecretKey = skB64 ? decodeBase64(skB64) : null;
  }

  const sessionKeys = respond({ initPacket, signedPreKeySecretKey, oneTimePreKeySecretKey });

  if (initPacket.oneTimePreKeyId !== null) {
    await deleteOneTimePreKeySecret({ myUserId, keyId: initPacket.oneTimePreKeyId });
  }

  return { sessionKeys, signedPreKey: { publicKey: spk.publicKey, privateKey: spk.privateKey } };
}
