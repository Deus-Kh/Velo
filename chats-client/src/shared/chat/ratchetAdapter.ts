import type { MessageEnvelope, RatchetSessionV2 } from '@velo/protocol';
import { decryptWithMessageKey, ratchetDecrypt, ratchetEncrypt } from '@velo/protocol';
import { associatedDataFor } from '../crypto/associatedData';
import { saveSession } from '../storage/sessionStore';
import { getV2MessageKey } from '../storage/v2MessageKeyStore';

/**
 * The only place the client touches the ratchet (T2.2).
 *
 * The pure step runs first. If it throws, nothing is persisted (R7). If it
 * succeeds, the advanced session is saved. Since T2.14 message keys are
 * NOT archived: the plaintext goes to the local message store instead and
 * the key is gone with the step (forward secrecy at rest). Only the
 * bounded skipped keys inside the session survive. Since T3.4 the step
 * returns no key material at all and wipes what it derived.
 *
 * Since T2.5 every envelope is authenticated over both identity keys and
 * the canonical header; the adapter supplies that associated data from
 * the Keychain and the trust pin.
 */
export async function persistStep(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
}): Promise<void> {
  await saveSession({ myUserId: params.myUserId, peerUserId: params.peerUserId, session: params.session });
}

export async function encryptAndPersist(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
  plaintext: string;
}): Promise<{ encrypted: MessageEnvelope; updatedSession: RatchetSessionV2 }> {
  const ad = await associatedDataFor({ myUserId: params.myUserId, peerUserId: params.peerUserId, direction: 'out' });
  const step = ratchetEncrypt(params.session, params.plaintext, ad);
  await persistStep({ myUserId: params.myUserId, peerUserId: params.peerUserId, session: step.session });
  return { encrypted: step.envelope, updatedSession: step.session };
}

export async function decryptAndPersist(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
  encrypted: MessageEnvelope;
}): Promise<{ plaintext: string; updatedSession: RatchetSessionV2 }> {
  const ad = await associatedDataFor({ myUserId: params.myUserId, peerUserId: params.peerUserId, direction: 'in' });
  const step = ratchetDecrypt(params.session, params.encrypted, ad);
  await persistStep({ myUserId: params.myUserId, peerUserId: params.peerUserId, session: step.session });
  return { plaintext: step.plaintext, updatedSession: step.session };
}

/**
 * LEGACY (pre-T2.14 archive): open an envelope with a message key archived
 * before T2.14. Used only by the one-time migration that moves old server
 * history into the local store; new messages never have an archived key.
 */
export async function decryptArchived(params: {
  myUserId: string;
  peerUserId: string;
  direction: 'in' | 'out';
  encrypted: MessageEnvelope;
}): Promise<string | null> {
  const mkB64 = await getV2MessageKey({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    direction: params.direction,
    dhPub: params.encrypted.header.dhPub,
    n: params.encrypted.header.n,
  });
  if (!mkB64) return null;
  const ad = await associatedDataFor({ myUserId: params.myUserId, peerUserId: params.peerUserId, direction: params.direction });
  return decryptWithMessageKey({ messageKeyB64: mkB64, envelope: params.encrypted, ad });
}
