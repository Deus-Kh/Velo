import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

import { hkdfSha256 } from './kdf';
import { fetchAndVerifyPreKeyBundle } from './prekeyBundle';
import { getSignedPreKeySecretBytesForUser } from './prekeys';
import {
  getOneTimePreKeySecret,
  deleteOneTimePreKeySecret,
} from '../storage/oneTimePreKeys';
import {
  ensureIdentityDhKeyPairForUser,
  getIdentityDhSecretKeyBytesForUser,
} from './identityDhKeys';

const INFO_X3DH_V1 = new Uint8Array([120, 51, 100, 104, 45, 118, 49]); // "x3dh-v1"

export type X3DHInitPacket = {
  peerUserId: string;
  ephPublicKey: string;
  signedPreKeyId: number;
  oneTimePreKeyId: number | null;
  initiatorIdentityDhPublicKey: string;
};

export type X3DHSessionKeys = {
  rootKey: string;
  chainKey: string;
};

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export async function x3dhInitiate(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<{
  initPacket: X3DHInitPacket;
  sessionKeys: X3DHSessionKeys;
}> {
  const { myUserId, peerUserId } = params;

  const bundle = await fetchAndVerifyPreKeyBundle(peerUserId);

  const myIdentityDhPubB64 = await ensureIdentityDhKeyPairForUser(myUserId);
  const myIdentityDhSk = await getIdentityDhSecretKeyBytesForUser(myUserId);

  const eph = nacl.box.keyPair();
  const ephPubB64 = encodeBase64(eph.publicKey);

  const spkPub = decodeBase64(bundle.signedPreKey.publicKey);
  const dh1 = nacl.scalarMult(eph.secretKey, spkPub);

  const dhParts: Uint8Array[] = [dh1];

  let oneTimePreKeyId: number | null = null;
  if (bundle.oneTimePreKey) {
    const opkPub = decodeBase64(bundle.oneTimePreKey.publicKey);
    const dh2 = nacl.scalarMult(eph.secretKey, opkPub);
    dhParts.push(dh2);
    oneTimePreKeyId = bundle.oneTimePreKey.keyId;
  }

  const dh3 = nacl.scalarMult(myIdentityDhSk, spkPub);
  dhParts.push(dh3);

  const ikm = concatBytes(dhParts);
  const okm = hkdfSha256({
    ikm,
    info: INFO_X3DH_V1,
    length: 64,
  });

  const rootKey = okm.slice(0, 32);
  const chainKey = okm.slice(32, 64);

  return {
    initPacket: {
      peerUserId,
      ephPublicKey: ephPubB64,
      signedPreKeyId: bundle.signedPreKey.keyId,
      oneTimePreKeyId,
      initiatorIdentityDhPublicKey: myIdentityDhPubB64,
    },
    sessionKeys: {
      rootKey: encodeBase64(rootKey),
      chainKey: encodeBase64(chainKey),
    },
  };
}

export async function x3dhRespond(params: {
  myUserId: string;
  initPacket: X3DHInitPacket;
}): Promise<X3DHSessionKeys> {
  const ephPub = decodeBase64(params.initPacket.ephPublicKey);
  const spkSk = await getSignedPreKeySecretBytesForUser(params.myUserId);

  const dh1 = nacl.scalarMult(spkSk, ephPub);
  const dhParts: Uint8Array[] = [dh1];

  if (params.initPacket.oneTimePreKeyId !== null) {
    const skB64 = await getOneTimePreKeySecret({
      myUserId: params.myUserId,
      keyId: params.initPacket.oneTimePreKeyId,
    });

    if (!skB64) {
      throw new Error('One-time prekey secret not found locally (cannot complete X3DH)');
    }

    const opkSk = decodeBase64(skB64);
    const dh2 = nacl.scalarMult(opkSk, ephPub);
    dhParts.push(dh2);

    await deleteOneTimePreKeySecret({
      myUserId: params.myUserId,
      keyId: params.initPacket.oneTimePreKeyId,
    });
  }

  const initiatorIdentityDhPub = decodeBase64(
    params.initPacket.initiatorIdentityDhPublicKey,
  );
  const dh3 = nacl.scalarMult(spkSk, initiatorIdentityDhPub);
  dhParts.push(dh3);

  const ikm = concatBytes(dhParts);
  const okm = hkdfSha256({ ikm, info: INFO_X3DH_V1, length: 64 });

  return {
    rootKey: encodeBase64(okm.slice(0, 32)),
    chainKey: encodeBase64(okm.slice(32, 64)),
  };
}
