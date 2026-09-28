import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';
import type { PreKeyBundle } from './types';
import { ProtocolError } from '../errors';

export function verifySignedPreKeyBundle(bundle: PreKeyBundle): void {
  const identityPk = decodeBase64(bundle.identitySignPublicKey); // Ed25519 pub
  const signedPreKeyPk = decodeBase64(bundle.signedPreKey.publicKey); // X25519 pub (message)
  const signature = decodeBase64(bundle.signedPreKey.signature); // Ed25519 detached sig

  const ok = nacl.sign.detached.verify(signedPreKeyPk, signature, identityPk);

  if (!ok) {
    throw new ProtocolError('IDENTITY_BINDING_INVALID', 'Invalid signedPreKey signature (possible MITM / key tampering)', {
      what: 'signedPreKeySignature',
      keyId: bundle.signedPreKey.keyId,
    });
  }
}
