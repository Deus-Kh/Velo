import type { MessageEnvelope, RatchetSessionV2 } from '@velo/protocol';
import { ratchetDecrypt, ratchetEncrypt } from '@velo/protocol';
import { associatedDataFor } from '../crypto/associatedData';
import { saveSession } from '../storage/sessionStore';

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
