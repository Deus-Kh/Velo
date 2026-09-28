import type { MessageEnvelope, RatchetSessionV2 } from '@velo/protocol';
import { decryptWithMessageKey, ratchetDecrypt, ratchetEncrypt } from '@velo/protocol';
import { associatedDataFor } from '../crypto/associatedData';
import { saveSession } from '../storage/sessionStore';
import { getV2MessageKey, putV2MessageKey } from '../storage/v2MessageKeyStore';

/**
 * The only place the client touches the ratchet (T2.2).
 *
 * The pure step runs first. If it throws, nothing is persisted (R7). If it
 * succeeds, the derived message keys are archived first and the advanced
 * session second, so a crash between the two can never leave a session
 * that has moved past a key the history view cannot recover.
 *
 * Since T2.5 every envelope is authenticated over both identity keys and
 * the canonical header; the adapter supplies that associated data from
 * the Keychain and the trust pin.
 */
async function persistStep(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
  derivedKeys: ReadonlyArray<{ direction: 'in' | 'out'; dhPub: string; n: number; messageKeyB64: string }>;
}): Promise<void> {
  for (const k of params.derivedKeys) {
    await putV2MessageKey({
      myUserId: params.myUserId,
      peerUserId: params.peerUserId,
      direction: k.direction,
      dhPub: k.dhPub,
      n: k.n,
      messageKeyB64: k.messageKeyB64,
    });
  }
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
  await persistStep({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session: step.session,
    derivedKeys: step.derivedKeys,
  });
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
  await persistStep({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session: step.session,
    derivedKeys: step.derivedKeys,
  });
  return { plaintext: step.plaintext, updatedSession: step.session };
}

/**
 * History path: open an archived envelope with its stored message key.
 * Returns null when no key is archived; throws on a failed authentication.
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
