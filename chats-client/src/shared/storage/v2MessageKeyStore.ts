import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { getOrCreateHistoryMasterKey } from '../crypto/historyMasterKey';

type Direction = 'in' | 'out';

function key(params: {
  myUserId: string;
  peerUserId: string;
  direction: Direction;
  dhPub: string;
  n: number;
}) {
  return `v2mk:${params.myUserId}:${params.peerUserId}:${params.direction}:${params.dhPub}:${params.n}`;
}

type StoredBlob = {
  nonce: string;      // base64 24 bytes
  ciphertext: string; // base64
};

export async function putV2MessageKey(params: {
  myUserId: string;
  peerUserId: string;
  direction: Direction;
  dhPub: string;
  n: number;
  messageKeyB64: string; // base64(32 bytes)
}): Promise<void> {
  const mkMaster = await getOrCreateHistoryMasterKey(params.myUserId);

  const nonce = nacl.randomBytes(24);
  const plain = decodeBase64(params.messageKeyB64);

  const cipher = nacl.secretbox(plain, nonce, mkMaster);

  const blob: StoredBlob = {
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(cipher),
  };

  await AsyncStorage.setItem(key(params), JSON.stringify(blob));
}

export async function getV2MessageKey(params: {
  myUserId: string;
  peerUserId: string;
  direction: Direction;
  dhPub: string;
  n: number;
}): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key(params));
  if (!raw) return null;

  let blob: StoredBlob;
  try {
    blob = JSON.parse(raw) as StoredBlob;
  } catch {
    return null;
  }

  const mkMaster = await getOrCreateHistoryMasterKey(params.myUserId);

  try {
    const nonce = decodeBase64(blob.nonce);
    const cipher = decodeBase64(blob.ciphertext);

    const plain = nacl.secretbox.open(cipher, nonce, mkMaster);
    if (!plain) return null;

    return encodeBase64(plain);
  } catch {
    return null;
  }
}

export async function deleteV2MessageKeysForPair(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `v2mk:${params.myUserId}:${params.peerUserId}:`;
  const toRemove = allKeys.filter((k) => k.startsWith(prefix));
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}
