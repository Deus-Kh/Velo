import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';
import type { PreKeyBundleResponse } from '../api/keys.api';

export function verifySignedPreKeyBundle(bundle: PreKeyBundleResponse): void {
  const identityPk = decodeBase64(bundle.identitySignPublicKey); // Ed25519 pub
  const signedPreKeyPk = decodeBase64(bundle.signedPreKey.publicKey); // X25519 pub (message)
  const signature = decodeBase64(bundle.signedPreKey.signature); // Ed25519 detached sig

  const ok = nacl.sign.detached.verify(signedPreKeyPk, signature, identityPk);

  if (!ok) {
    throw new Error('Invalid signedPreKey signature (possible MITM / key tampering)');
  }
}
