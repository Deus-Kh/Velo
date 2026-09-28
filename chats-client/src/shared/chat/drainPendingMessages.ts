import { sendAuto } from '../socket/sendAuto';
import { listPendingMessages, removePendingMessage, upsertPendingMessage } from '../storage/pendingMessageStore';
import { classifyPendingMessageError } from './protocolErrors';

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
