import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

export interface IdentityDhKeyPair {
  publicKey: string;  // base64
  privateKey: string; // base64 (X25519 secret key)
}

function serviceForUser(userId: string) {
  return `identity-dh:${userId}`;
}

export async function getIdentityDhKeyPairForUser(userId: string): Promise<IdentityDhKeyPair | null> {
  const creds = await Keychain.getGenericPassword({ service: serviceForUser(userId) });
  if (!creds) return null;
  return JSON.parse(creds.password) as IdentityDhKeyPair;
}

export async function ensureIdentityDhKeyPairForUser(userId: string): Promise<string> {
  const existing = await getIdentityDhKeyPairForUser(userId);
  if (existing?.publicKey) return existing.publicKey;

  const kp = nacl.box.keyPair(); // X25519
  const payload: IdentityDhKeyPair = {
    publicKey: encodeBase64(kp.publicKey),
    privateKey: encodeBase64(kp.secretKey),
  };

  await Keychain.setGenericPassword('identity-dh', JSON.stringify(payload), {
    service: serviceForUser(userId),
  });

  return payload.publicKey;
}

export async function getIdentityDhSecretKeyBytesForUser(userId: string): Promise<Uint8Array> {
  const kp = await getIdentityDhKeyPairForUser(userId);
  if (!kp) throw new Error('Identity DH keypair not found');
  return decodeBase64(kp.privateKey);
}
