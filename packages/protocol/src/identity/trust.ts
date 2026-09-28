import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import type { Identity } from './binding';

export type IdentityCheck = 'first-contact' | 'match' | 'mismatch';

/**
 * Compare a presented identity with the pinned one (spec T2.13 step 2).
 * Pure: storage of the pin is the client's job.
 *
 * A pin that predates the binding (T1.3 format) knows only the signing
 * key; its DH key is null. Because the caller verifies the binding before
 * calling this, a matching signing key vouches for the DH key, so such a
 * pin counts as a match and the caller upgrades it.
 */
export function checkIdentity(
  pinned: { identitySignPublicKey: string; identityDhPublicKey: string | null } | null,
  presented: Identity,
): IdentityCheck {
  if (!pinned) return 'first-contact';
  if (normalizeB64(pinned.identitySignPublicKey) !== normalizeB64(presented.identitySignPublicKey)) return 'mismatch';
  if (pinned.identityDhPublicKey !== null && normalizeB64(pinned.identityDhPublicKey) !== normalizeB64(presented.identityDhPublicKey)) {
    return 'mismatch';
  }
  return 'match';
}

/**
 * The only throw site for IDENTITY_MISMATCH: never proceed on a mismatch.
 * Context carries the peer id and truncated public keys (public material,
 * R3 allows truncated public keys) so the UI can show what changed.
 */
export function requireIdentityMatch(
  pinned: { identitySignPublicKey: string; identityDhPublicKey: string | null } | null,
  presented: Identity,
  peerUserId: string,
): Exclude<IdentityCheck, 'mismatch'> {
  const result = checkIdentity(pinned, presented);
  if (result === 'mismatch') {
    throw new ProtocolError('IDENTITY_MISMATCH', 'Identity key for ' + peerUserId + ' does not match the pinned key', {
      peerUserId,
      pinnedSign: (pinned?.identitySignPublicKey ?? '').slice(0, 8),
      presentedSign: presented.identitySignPublicKey.slice(0, 8),
    });
  }
  return result;
}
