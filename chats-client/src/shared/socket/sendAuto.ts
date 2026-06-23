import { sendMessageV2 } from './messaging';
import { ensureV2Session } from '../crypto/sessionBootstrap';
import { useAuthStore } from '../../store/auth.store';
import type { ReplyReference } from '../chat/types';

function requireMyUserId(): string {
  const myUserId = useAuthStore.getState().userId;
  if (!myUserId) throw new Error('Not authenticated');
  return myUserId;
}

/**
 * Sends a message using the active v2 protocol only.
 * Policy:
 * - Ensure local v2 session exists before every send
 * - Attach initPacket only when this send created the session
 * - If session creation or send fails, fail loudly
 */
export async function sendAuto(params: {
  toUserId: string;
  plaintext: string;
  clientMessageId: string;
  replyTo?: ReplyReference | null;
}): Promise<{ serverMessageId: string; protoVersion: 2 }> {
  const myUserId = requireMyUserId();

  const sessionBootstrap = await ensureV2Session({
    myUserId,
    peerUserId: params.toUserId,
  });

  const r = await sendMessageV2({
    toUserId: params.toUserId,
    plaintext: params.plaintext,
    clientMessageId: params.clientMessageId,
    initPacket: sessionBootstrap.initPacket,
    replyTo: params.replyTo ?? null,
  });
  return { ...r, protoVersion: 2 };
}
