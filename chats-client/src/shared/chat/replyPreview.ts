import { describeMessage, type LucideIconName } from './describeMessage';
import type { UIMessage } from './types';

/** What a bubble shows above its text when the message answers another one. */
export type ReplyPreview = {
  title: string;
  text: string;
  icon?: LucideIconName | null;
  targetMessageId: string | null;
};

export function resolveReplyPreview(message: UIMessage, allMessages: UIMessage[], peerName: string): ReplyPreview | null {
  if (!message.replyTo) return null;

  const match = allMessages.find(
    (item) =>
      (message.replyTo?.serverMessageId && item.serverMessageId === message.replyTo.serverMessageId) ||
      (message.replyTo?.clientMessageId && item.clientMessageId === message.replyTo.clientMessageId),
  );

  if (!match) {
    return {
      title: 'Original message',
      text: 'Message not available in the current loaded history.',
      targetMessageId: null,
    };
  }

  const description = describeMessage(match);
  return {
    title: match.mine ? 'You' : peerName,
    text: description.text,
    icon: description.icon,
    targetMessageId: match.id,
  };
}
