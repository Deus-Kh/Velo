import {
  ProtocolError,
  initResponderSession,
  isProtocolError,
  ratchetDecrypt,
  type MessageEnvelope,
  type RatchetSessionV2,
  type X3DHInitPacket,
} from '@velo/protocol';
import { associatedDataFor } from '../crypto/associatedData';
import { authenticateInitiator } from '../crypto/identityTrust';
import { x3dhRespond } from '../crypto/x3dh';
import { hasSeenBootstrap, markBootstrapSeen } from '../storage/bootstrapReplayCache';
import { deleteOneTimePreKeySecret } from '../storage/oneTimePreKeys';
import { loadSession } from '../storage/sessionStore';
import { decryptAndPersist, persistStep } from './ratchetAdapter';

export type IncomingOutcome = 'primary' | 'bootstrapped';

/**
 * Bootstrap lifecycle for an inbound message (T2.11, P1-11):
 *
 *  - no session and an initPacket: authenticate the initiator against the
 *    pin, refuse a replayed packet, build a candidate session and decrypt
 *    the message with it; only then persist the keys and the session,
 *    delete the one-time prekey secret and remember the packet (R7: nothing
 *    is written before the first decrypt succeeds). A packet whose message
 *    does not decrypt leaves no trace and keeps its one-time prekey secret,
 *    so a bogus packet cannot burn the pool.
 *  - a session exists: decrypt with it (the packet, if any, is ignored;
 *    T2.11's second commit resolves glare and peer resets here).
 */
export async function receiveIncoming(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket | null;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; outcome: IncomingOutcome }> {
  const { myUserId, peerUserId, initPacket, encrypted } = params;
  const session = await loadSession({ myUserId, peerUserId });

  if (session) {
    const r = await decryptAndPersist({ myUserId, peerUserId, session: session as RatchetSessionV2, encrypted });
    return { plaintext: r.plaintext, outcome: 'primary' };
  }

  if (!initPacket) {
    throw new ProtocolError('MISSING_BOOTSTRAP', 'Missing v2 session and initPacket for incoming message');
  }

  const { plaintext } = await bootstrapAndDecrypt({ myUserId, peerUserId, initPacket, encrypted });
  return { plaintext, outcome: 'bootstrapped' };
}

/** Build a candidate responder session from the packet, decrypt with it, and persist on success. */
export async function bootstrapAndDecrypt(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; session: RatchetSessionV2 }> {
  const { myUserId, peerUserId, initPacket, encrypted } = params;

  // T2.13: the initiator's identity DH key must be the pinned one. Throws IDENTITY_MISMATCH.
  await authenticateInitiator({ myUserId, peerUserId, initPacket });

  if (await hasSeenBootstrap({ myUserId, peerUserId, ephPublicKey: initPacket.ephPublicKey })) {
    throw new ProtocolError('REPLAY_DETECTED', 'Bootstrap packet already used for this peer', { peerUserId });
  }

  const { sessionKeys, signedPreKey, oneTimePreKeyId } = await x3dhRespond({ myUserId, initPacket });
  const candidate = initResponderSession({ peerUserId, sharedSecret: sessionKeys.rootKey, signedPreKey });

  const ad = await associatedDataFor({ myUserId, peerUserId, direction: 'in' });
  let step;
  try {
    step = ratchetDecrypt(candidate, encrypted, ad);
  } catch (e) {
    // A packet whose message does not decrypt is not a session: persist nothing.
    if (isProtocolError(e)) throw e;
    throw new ProtocolError('DECRYPT_FAILED', 'Bootstrap message did not decrypt', { peerUserId });
  }

  await persistStep({ myUserId, peerUserId, session: step.session, derivedKeys: step.derivedKeys });
  if (oneTimePreKeyId !== null) await deleteOneTimePreKeySecret({ myUserId, keyId: oneTimePreKeyId });
  await markBootstrapSeen({ myUserId, peerUserId, ephPublicKey: initPacket.ephPublicKey });

  return { plaintext: step.plaintext, session: step.session };
}
