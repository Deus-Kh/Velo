import { sendAuto } from '../socket/sendAuto';
import {
  listPendingMessages,
  removePendingMessage,
  upsertPendingMessage,
  type PendingMessageErrorCode,
} from '../storage/pendingMessageStore';

function classifyPendingMessageError(error: unknown): PendingMessageErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (message.includes('Socket')) return 'socket_unavailable';
  if (message.includes('Missing v2 session and initPacket')) return 'missing_bootstrap';
  if (message.includes('No v2 session')) return 'no_session';
  if (message.includes('Decrypt')) return 'decrypt_failed';
  if (message.includes('storage')) return 'storage_corruption';
  if (message) return 'send_failed';
  return 'unknown';
}

export async function drainPendingMessagesForUser(myUserId: string): Promise<void> {
  const pending = await listPendingMessages(myUserId);

  for (const item of pending) {
    try {
      await sendAuto({
        toUserId: item.toUserId,
        plaintext: item.text,
        clientMessageId: item.clientMessageId,
        replyTo: item.replyTo ?? null,
      });

      await removePendingMessage(myUserId, item.clientMessageId);
    } catch (e) {
      await upsertPendingMessage(myUserId, {
        ...item,
        attempts: item.attempts + 1,
        lastErrorCode: classifyPendingMessageError(e),
      });
    }
  }
}
