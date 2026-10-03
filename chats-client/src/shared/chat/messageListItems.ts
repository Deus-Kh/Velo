import type { UIMessage } from './types';

/**
 * C1: the chat screen's list model. Messages are grouped under day
 * separators and reversed for the inverted list (newest first).
 */
export type MessageListItem =
  | { type: 'message'; id: string; message: UIMessage }
  | { type: 'separator'; id: string; label: string };

export function formatDayLabel(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
  });
}

export function buildMessageListItems(messages: UIMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let previousDayKey: string | null = null;

  for (const message of messages) {
    const date = new Date(message.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    if (dayKey !== previousDayKey) {
      items.push({
        type: 'separator',
        id: `separator-${dayKey}`,
        label: formatDayLabel(message.createdAt),
      });
      previousDayKey = dayKey;
    }

    items.push({
      type: 'message',
      id: message.id,
      message,
    });
  }

  return items.reverse();
}
