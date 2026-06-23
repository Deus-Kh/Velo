import nacl from 'tweetnacl';
import { getStoredKeyPair } from './keypair';
import { decodeKey, encodeKey } from './encoding';

/**
 * Computes a shared secret using Diffie–Hellman (NaCl box.before)
 * @param theirPublicKeyBase64 - recipient public key (base64)
 */

export async function computeSharedSecret(
  myUserId:string,
  theirPublicKeyBase64: string,
): Promise<string> {
  const keyPair = await getStoredKeyPair(myUserId);

  if (!keyPair) {
    throw new Error('Key pair not found');
  }

  const myPrivateKey = decodeKey(keyPair.privateKey);
  const theirPublicKey = decodeKey(theirPublicKeyBase64);

  const sharedSecret = nacl.box.before(
    theirPublicKey,
    myPrivateKey,
  );

  return encodeKey(sharedSecret);
}

