import { ProtocolError, type AssociatedData } from '@velo/protocol';
import { ensureIdentityKeyPairForUser } from './identityKeys';
import { getTrustedIdentity } from '../storage/trustedIdentities';

/**
 * Associated data for the message MAC (T2.5): the sender's and receiver's
 * identity signing keys. Ours comes from the Keychain, the peer's from the
 * pin — which T2.13 guarantees exists before any session does. A message
 * re-attributed to another pair therefore fails authentication.
 */
export async function associatedDataFor(params: {
  myUserId: string;
  peerUserId: string;
  direction: 'out' | 'in';
}): Promise<AssociatedData> {
  const mine = await ensureIdentityKeyPairForUser(params.myUserId);
  const pinned = await getTrustedIdentity({ myUserId: params.myUserId, peerUserId: params.peerUserId });
  if (!pinned) {
    throw new ProtocolError('NO_SESSION', 'No pinned identity for this peer', { peerUserId: params.peerUserId });
  }
  return params.direction === 'out'
    ? { senderIdentityKey: mine, receiverIdentityKey: pinned.identitySignPublicKey }
    : { senderIdentityKey: pinned.identitySignPublicKey, receiverIdentityKey: mine };
}
