import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

export interface EncryptedPayload {
  nonce: string;       // base64
  ciphertext: string;  // base64
}

export function encryptMessage(
  plaintext: string,
  sharedSecretBase64: string,
): EncryptedPayload {
  const sharedSecret = decodeBase64(sharedSecretBase64);

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = decodeUTF8(plaintext);

  const boxed = nacl.box.after(messageBytes, nonce, sharedSecret);

  return {
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(boxed),
  };
}

export function decryptMessage(
  payload: EncryptedPayload,
  sharedSecretBase64: string,
): string {
  const sharedSecret = decodeBase64(sharedSecretBase64);

  const nonce = decodeBase64(payload.nonce);
  const ciphertext = decodeBase64(payload.ciphertext);

  const opened = nacl.box.open.after(ciphertext, nonce, sharedSecret);

  if (!opened) {
    throw new Error('Failed to decrypt message (invalid secret/nonce/ciphertext)');
  }

  return encodeUTF8(opened);
}
