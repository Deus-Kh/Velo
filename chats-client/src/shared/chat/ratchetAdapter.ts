import type { RatchetSessionV2, V2Encrypted } from '@velo/protocol';
import { ratchetDecrypt, ratchetEncrypt } from '@velo/protocol';
import { saveSession } from '../storage/sessionStore';
import { putV2MessageKey } from '../storage/v2MessageKeyStore';

/**
 * The only place the client touches the ratchet (T2.2).
 *
 * The pure step runs first. If it throws, nothing is persisted (R7). If it
 * succeeds, the derived message keys are archived first and the advanced
 * session second, so a crash between the two can never leave a session
 * that has moved past a key the history view cannot recover.
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
}): Promise<{ encrypted: V2Encrypted; updatedSession: RatchetSessionV2 }> {
  const step = ratchetEncrypt(params.session, params.plaintext);
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
  encrypted: V2Encrypted;
}): Promise<{ plaintext: string; updatedSession: RatchetSessionV2 }> {
  const step = ratchetDecrypt(params.session, params.encrypted);
  await persistStep({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session: step.session,
    derivedKeys: step.derivedKeys,
  });
  return { plaintext: step.plaintext, updatedSession: step.session };
}
