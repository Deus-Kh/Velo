import type { PreKeyBundle } from './types';
import { ProtocolError } from '../errors';
import { verifySignedPreKey } from './signedPrekey';

/** The bundle's signed prekey must be signed by its identity key over the tagged (keyId, publicKey) (T2.10). */
export function verifySignedPreKeyBundle(bundle: PreKeyBundle): void {
  const ok = verifySignedPreKey({
    identitySignPublicKey: bundle.identitySignPublicKey,
    keyId: bundle.signedPreKey.keyId,
    publicKey: bundle.signedPreKey.publicKey,
    signature: bundle.signedPreKey.signature,
  });

  if (!ok) {
    throw new ProtocolError('IDENTITY_BINDING_INVALID', 'Invalid signedPreKey signature (possible MITM / key tampering)', {
      what: 'signedPreKeySignature',
      keyId: bundle.signedPreKey.keyId,
    });
  }
}
