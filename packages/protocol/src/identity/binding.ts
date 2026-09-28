import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { utf8Encode } from '../primitives/utf8';

/**
 * Identity binding (spec T2.13, DEVIATION-5).
 *
 * Velo has two identity keys: an Ed25519 signing key (IK_sign) and an
 * X25519 DH key (IK_dh). Nothing tied them together, so a server could
 * swap the DH key without changing the safety number (P0-9). The binding
 * is a signature by IK_sign over a domain string and IK_dh; it is stored
 * on the server, returned in every bundle and identity lookup, and
 * verified before either key is used or pinned.
 */
export const IDENTITY_BINDING_DOMAIN = 'velo-identity-binding-v1';

export interface Identity {
  identitySignPublicKey: string; // base64 Ed25519 public key
  identityDhPublicKey: string; // base64 X25519 public key
}

export interface BoundIdentity extends Identity {
  identityBindingSignature: string; // base64 Ed25519 detached signature
}

function bindingMessage(identityDhPublicKey: string): Uint8Array {
  const domain = utf8Encode(IDENTITY_BINDING_DOMAIN);
  const dh = decodeBase64(normalizeB64(identityDhPublicKey));
  if (dh.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'identityDhPublicKey must be 32 bytes', { what: 'identityDhPublicKey', length: dh.length });
  }
  const out = new Uint8Array(domain.length + dh.length);
  out.set(domain, 0);
  out.set(dh, domain.length);
  return out;
}

/** Sign(IK_sign_priv, "velo-identity-binding-v1" || IK_dh). */
export function signIdentityBinding(identitySignSecretKey: Uint8Array, identityDhPublicKey: string): string {
  if (identitySignSecretKey.length !== 64) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'identitySignSecretKey must be 64 bytes', { what: 'identitySignSecretKey', length: identitySignSecretKey.length });
  }
  return encodeBase64(nacl.sign.detached(bindingMessage(identityDhPublicKey), identitySignSecretKey));
}

/** Throws IDENTITY_BINDING_INVALID unless the binding signature verifies. */
export function verifyIdentityBinding(identity: BoundIdentity): void {
  const sign = decodeBase64(normalizeB64(identity.identitySignPublicKey));
  if (sign.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'identitySignPublicKey must be 32 bytes', { what: 'identitySignPublicKey', length: sign.length });
  }
  let sig: Uint8Array;
  try {
    sig = decodeBase64(normalizeB64(identity.identityBindingSignature ?? ''));
  } catch {
    sig = new Uint8Array(0);
  }
  if (sig.length !== 64) {
    throw new ProtocolError('IDENTITY_BINDING_INVALID', 'Identity binding signature missing or malformed', { what: 'identityBindingSignature', length: sig.length });
  }
  if (!nacl.sign.detached.verify(bindingMessage(identity.identityDhPublicKey), sig, sign)) {
    throw new ProtocolError('IDENTITY_BINDING_INVALID', 'Identity binding signature does not verify', { what: 'identityBindingSignature' });
  }
}
