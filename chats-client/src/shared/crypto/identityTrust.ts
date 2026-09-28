import {
  ProtocolError,
  requireIdentityMatch,
  verifyIdentityBinding,
  type BoundIdentity,
  type X3DHInitPacket,
} from '@velo/protocol';
import { keysApi } from '../api/keys.api';
import { deleteSession } from '../storage/sessionStore';
import { deleteV2MessageKeysForPair } from '../storage/v2MessageKeyStore';
import { getTrustedIdentity, setTrustedIdentity, type TrustedIdentity } from '../storage/trustedIdentities';

/**
 * Identity trust in the crypto path (T2.13, P0-9).
 *
 * The pin is the source of truth. It is created silently on first contact
 * (TOFU) from a server response whose binding verifies, and afterwards
 * every bundle and every initPacket must agree with it. A disagreement is
 * IDENTITY_MISMATCH and nothing proceeds until the user accepts the new
 * identity (acceptNewIdentity) or verifies out of band.
 */

/** Fetch the peer's bound identity from the server and verify the binding. */
export async function fetchBoundIdentity(peerUserId: string): Promise<BoundIdentity> {
  const res = await keysApi.getIdentityKey(peerUserId);
  const { identitySignPublicKey, identityDhPublicKey, identityBindingSignature } = res.data;
  if (!identityDhPublicKey || !identityBindingSignature) {
    throw new ProtocolError('IDENTITY_BINDING_INVALID', 'Peer has not published a bound identity', { peerUserId });
  }
  const identity = { identitySignPublicKey, identityDhPublicKey, identityBindingSignature };
  verifyIdentityBinding(identity);
  return identity;
}

/**
 * Compare a presented, binding-verified identity with the pin. First contact
 * pins it; a legacy pin (no DH key) is upgraded; a mismatch throws.
 */
export async function enforcePinnedIdentity(params: {
  myUserId: string;
  peerUserId: string;
  presented: BoundIdentity;
}): Promise<TrustedIdentity> {
  const { myUserId, peerUserId, presented } = params;
  verifyIdentityBinding(presented);
  const pinned = await getTrustedIdentity({ myUserId, peerUserId });
  const result = requireIdentityMatch(pinned, presented, peerUserId);

  if (result === 'first-contact' || pinned?.identityDhPublicKey === null) {
    await setTrustedIdentity({
      myUserId,
      peerUserId,
      identitySignPublicKey: presented.identitySignPublicKey,
      identityDhPublicKey: presented.identityDhPublicKey,
    });
  }
  return { identitySignPublicKey: presented.identitySignPublicKey, identityDhPublicKey: presented.identityDhPublicKey };
}

/**
 * Responder side: the initPacket's initiator DH key must be the pinned one.
 * Without a pin (or with a legacy pin), the identity is fetched, its binding
 * verified and pinned first — the packet itself is never trusted for this.
 */
export async function authenticateInitiator(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket;
}): Promise<void> {
  const { myUserId, peerUserId, initPacket } = params;
  let pinned = await getTrustedIdentity({ myUserId, peerUserId });
  if (!pinned || pinned.identityDhPublicKey === null) {
    const fetched = await fetchBoundIdentity(peerUserId);
    pinned = await enforcePinnedIdentity({ myUserId, peerUserId, presented: fetched });
  }
  requireIdentityMatch(
    pinned,
    { identitySignPublicKey: pinned.identitySignPublicKey, identityDhPublicKey: initPacket.initiatorIdentityDhPublicKey },
    peerUserId,
  );
}

/**
 * The user accepted the peer's new identity (reinstall, key rotation):
 * re-pin from the server (binding verified) and drop the session so the
 * next message re-bootstraps on the new keys.
 */
export async function acceptNewIdentity(params: { myUserId: string; peerUserId: string }): Promise<TrustedIdentity> {
  const { myUserId, peerUserId } = params;
  const fetched = await fetchBoundIdentity(peerUserId);
  await setTrustedIdentity({
    myUserId,
    peerUserId,
    identitySignPublicKey: fetched.identitySignPublicKey,
    identityDhPublicKey: fetched.identityDhPublicKey,
  });
  await deleteSession({ myUserId, peerUserId });
  await deleteV2MessageKeysForPair({ myUserId, peerUserId });
  return { identitySignPublicKey: fetched.identitySignPublicKey, identityDhPublicKey: fetched.identityDhPublicKey };
}
