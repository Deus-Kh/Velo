import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';

/**
 * Server-side check of the identity binding (T2.13): the Ed25519 signing key
 * must have signed "velo-identity-binding-v1" || IK_dh. The server verifies
 * it on upload so it never stores or serves an inconsistent identity; the
 * clients verify it again on every bundle and identity lookup (the server
 * is not trusted for this, the check here only keeps the data clean).
 *
 * Mirrors packages/protocol/src/identity/binding.ts; the domain string is a
 * wire constant and must stay identical on both sides.
 */
export const IDENTITY_BINDING_DOMAIN = 'velo-identity-binding-v1';

export function verifyIdentityBinding(params: {
  identitySignPublicKey: string;
  identityDhPublicKey: string;
  identityBindingSignature: string;
}): boolean {
  try {
    const sign = decodeBase64(params.identitySignPublicKey);
    const dh = decodeBase64(params.identityDhPublicKey);
    const sig = decodeBase64(params.identityBindingSignature);
    if (sign.length !== 32 || dh.length !== 32 || sig.length !== 64) return false;
    const domain = Buffer.from(IDENTITY_BINDING_DOMAIN, 'utf8');
    const message = new Uint8Array(domain.length + dh.length);
    message.set(domain, 0);
    message.set(dh, domain.length);
    return nacl.sign.detached.verify(message, sig, sign);
  } catch {
    return false;
  }
}
