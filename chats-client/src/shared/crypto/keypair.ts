import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeKey } from './encoding';

// const KEYCHAIN_SERVICE = 'e2ee-keypair';

export interface StoredKeyPair {
  publicKey: string;   // base64
  privateKey: string;  // base64
}

function serviceForUser(userId: string) {
  return `e2ee-keypair:${userId}`;
}

export async function generateAndStoreKeyPair(userId:string): Promise<string> {
  const keyPair = nacl.box.keyPair();

  const publicKey = encodeKey(keyPair.publicKey);
  const privateKey = encodeKey(keyPair.secretKey);

  await Keychain.setGenericPassword(
    'keypair',
    JSON.stringify({ publicKey, privateKey } satisfies StoredKeyPair),
    { service: serviceForUser(userId) }
  );

  return publicKey;
}

export async function getStoredKeyPair(userId:string): Promise<StoredKeyPair | null> {
  const creds = await Keychain.getGenericPassword({
    service: serviceForUser(userId),
  });

  if (!creds) return null;

  return JSON.parse(creds.password) as StoredKeyPair;
}

export async function getMyPublicKey(userId:string): Promise<string> {
  const kp = await getStoredKeyPair(userId);
  if (!kp) throw new Error('Key pair not found');
  return kp.publicKey;
}
