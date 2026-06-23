import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

export interface IdentityKeyPair {
  publicKey: string;  // base64
  privateKey: string; // base64
}

function serviceForUser(userId: string) {
  return `identity-sign:${userId}`;
}

/**
 * Returns stored identity keypair for userId or null if missing.
 */
export async function getIdentityKeyPairForUser(
  userId: string,
): Promise<IdentityKeyPair | null> {
  const creds = await Keychain.getGenericPassword({ service: serviceForUser(userId) });
  if (!creds) return null;
  return JSON.parse(creds.password) as IdentityKeyPair;
}

/**
 * Ensures identity keypair exists for userId. Generates + stores if missing.
 * Returns publicKey (base64).
 */
export async function ensureIdentityKeyPairForUser(userId: string): Promise<string> {
  const existing = await getIdentityKeyPairForUser(userId);
  if (existing?.publicKey) return existing.publicKey;

  const kp = nacl.sign.keyPair();

  const payload: IdentityKeyPair = {
    publicKey: encodeBase64(kp.publicKey),
    privateKey: encodeBase64(kp.secretKey),
  };

  await Keychain.setGenericPassword(
    'identity',
    JSON.stringify(payload),
    { service: serviceForUser(userId) }
  );

  return payload.publicKey;
}

/**
 * Helper for later steps (signatures): returns Uint8Array secret key.
 */
export async function getIdentitySecretKeyBytesForUser(userId: string): Promise<Uint8Array> {
  const kp = await getIdentityKeyPairForUser(userId);
  if (!kp) throw new Error('Identity keypair not found');
  return decodeBase64(kp.privateKey);
}
