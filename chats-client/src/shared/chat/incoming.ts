import {
  ProtocolError,
  glareWinner,
  initResponderSession,
  isProtocolError,
  ratchetDecrypt,
  sessionHasReceived,
  type MessageEnvelope,
  type RatchetSessionV2,
  type X3DHInitPacket,
} from '@velo/protocol';
import { associatedDataFor } from '../crypto/associatedData';
import { authenticateInitiator } from '../crypto/identityTrust';
import { x3dhRespond } from '../crypto/x3dh';
import { hasSeenBootstrap, markBootstrapSeen } from '../storage/bootstrapReplayCache';
import { deleteOneTimePreKeySecret } from '../storage/oneTimePreKeys';
import { deleteSecondarySession, loadSecondarySession, loadSession, saveSecondarySession } from '../storage/sessionStore';
import { decryptAndPersist, persistStep } from './ratchetAdapter';

export type IncomingOutcome = 'primary' | 'secondary' | 'bootstrapped' | 'glare-secondary' | 'glare-adopted' | 'peer-reset-adopted';

/**
 * Inbound message handling (T2.11, P1-11). Every path obeys R7: nothing is
 * persisted before the message decrypts.
 *
 *  - No session + initPacket: bootstrap (see bootstrapAndDecrypt).
 *  - Session exists + a packet not seen before: the peer built its own
 *    session — either both sides bootstrapped at once (glare) or the peer
 *    reset locally and re-initiated. A candidate session is built from the
 *    packet and must decrypt the message, otherwise nothing changes.
 *      · glare (our session has never received): the lower user id's
 *        session wins. The winner keeps its session and stores the peer's
 *        as a decrypt-only secondary until the peer has switched; the loser
 *        adopts the peer's session as primary.
 *      · established session: the peer re-initiated; adopt its session.
 *  - Otherwise decrypt with the primary; on failure, with the secondary if
 *    one exists. A primary success from the peer retires the secondary.
 */
export async function receiveIncoming(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket | null;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; outcome: IncomingOutcome }> {
  const { myUserId, peerUserId, initPacket, encrypted } = params;
  const session = await loadSession({ myUserId, peerUserId });

  if (!session) {
    if (!initPacket) throw new ProtocolError('MISSING_BOOTSTRAP', 'Missing v2 session and initPacket for incoming message');
    const { plaintext } = await bootstrapAndDecrypt({ myUserId, peerUserId, initPacket, encrypted });
    return { plaintext, outcome: 'bootstrapped' };
  }

  if (initPacket && !(await hasSeenBootstrap({ myUserId, peerUserId, ephPublicKey: initPacket.ephPublicKey }))) {
    const candidate = await decryptWithCandidate({ myUserId, peerUserId, initPacket, encrypted });
    if (!sessionHasReceived(session as RatchetSessionV2) && glareWinner(myUserId, peerUserId)) {
      // Glare, we win: keep ours, decrypt the peer's in-flight messages with theirs.
      await persistStep({ myUserId, peerUserId, session: session as RatchetSessionV2 });
      await saveSecondarySession({ myUserId, peerUserId, session: candidate.session });
      await finishBootstrap({ myUserId, peerUserId, initPacket, oneTimePreKeyId: candidate.oneTimePreKeyId });
      return { plaintext: candidate.plaintext, outcome: 'glare-secondary' };
    }
    // Glare, we lose — or the peer reset and re-initiated: adopt the peer's session.
    await persistStep({ myUserId, peerUserId, session: candidate.session });
    await deleteSecondarySession({ myUserId, peerUserId });
    await finishBootstrap({ myUserId, peerUserId, initPacket, oneTimePreKeyId: candidate.oneTimePreKeyId });
    return { plaintext: candidate.plaintext, outcome: sessionHasReceived(session as RatchetSessionV2) ? 'peer-reset-adopted' : 'glare-adopted' };
  }

  try {
    const r = await decryptAndPersist({ myUserId, peerUserId, session: session as RatchetSessionV2, encrypted });
    // The peer sends on our session: any glare secondary is no longer needed.
    if (await loadSecondarySession({ myUserId, peerUserId })) await deleteSecondarySession({ myUserId, peerUserId });
    return { plaintext: r.plaintext, outcome: 'primary' };
  } catch (e) {
    const secondary = await loadSecondarySession({ myUserId, peerUserId });
    if (!secondary || !isProtocolError(e) || (e.code !== 'DECRYPT_FAILED' && e.code !== 'HEADER_TAMPERED' && e.code !== 'UNKNOWN_OLD_MESSAGE')) throw e;
    const ad = await associatedDataFor({ myUserId, peerUserId, direction: 'in' });
    const step = ratchetDecrypt(secondary as RatchetSessionV2, encrypted, ad);
    await persistStep({ myUserId, peerUserId, session: session as RatchetSessionV2 });
    await saveSecondarySession({ myUserId, peerUserId, session: step.session });
    return { plaintext: step.plaintext, outcome: 'secondary' };
  }
}

/** Build a candidate responder session from the packet, decrypt with it, and persist on success (first contact). */
export async function bootstrapAndDecrypt(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; session: RatchetSessionV2 }> {
  const { myUserId, peerUserId, initPacket, encrypted } = params;
  const candidate = await decryptWithCandidate({ myUserId, peerUserId, initPacket, encrypted });
  await persistStep({ myUserId, peerUserId, session: candidate.session });
  await finishBootstrap({ myUserId, peerUserId, initPacket, oneTimePreKeyId: candidate.oneTimePreKeyId });
  return { plaintext: candidate.plaintext, session: candidate.session };
}

/** Authenticate, refuse replays, build the candidate session and decrypt with it. Persists nothing. */
async function decryptWithCandidate(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; session: RatchetSessionV2; oneTimePreKeyId: number | null }> {
  const { myUserId, peerUserId, initPacket, encrypted } = params;

  // T2.13: the initiator's identity DH key must be the pinned one. Throws IDENTITY_MISMATCH.
  await authenticateInitiator({ myUserId, peerUserId, initPacket });

  if (await hasSeenBootstrap({ myUserId, peerUserId, ephPublicKey: initPacket.ephPublicKey })) {
    throw new ProtocolError('REPLAY_DETECTED', 'Bootstrap packet already used for this peer', { peerUserId });
  }

  const { sessionKeys, signedPreKey, oneTimePreKeyId } = await x3dhRespond({ myUserId, initPacket });
  const candidate = initResponderSession({ peerUserId, sharedSecret: sessionKeys.rootKey, headerKeyA: sessionKeys.headerKeyA, nextHeaderKeyB: sessionKeys.nextHeaderKeyB, signedPreKey });
  const ad = await associatedDataFor({ myUserId, peerUserId, direction: 'in' });
  const step = ratchetDecrypt(candidate, encrypted, ad);
  return { plaintext: step.plaintext, session: step.session, oneTimePreKeyId };
}

/** After the session is persisted: drop the one-time prekey secret and remember the packet. */
async function finishBootstrap(params: { myUserId: string; peerUserId: string; initPacket: X3DHInitPacket; oneTimePreKeyId: number | null }): Promise<void> {
  const { myUserId, peerUserId, initPacket, oneTimePreKeyId } = params;
  if (oneTimePreKeyId !== null) await deleteOneTimePreKeySecret({ myUserId, keyId: oneTimePreKeyId });
  await markBootstrapSeen({ myUserId, peerUserId, ephPublicKey: initPacket.ephPublicKey });
}
