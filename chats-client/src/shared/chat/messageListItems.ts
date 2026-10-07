import type { UIMessage } from './types';
import { albumKeyOf, groupAlbumRuns } from '../media/albums';

/**
 * C1: the chat screen's list model. Messages are grouped under day
 * separators and reversed for the inverted list (newest first). Photos sent
 * together as an album become one item with its messages in album order.
 */
export type MessageListItem =
  | { type: 'message'; id: string; message: UIMessage }
  | { type: 'album'; id: string; messages: UIMessage[] }
  | { type: 'separator'; id: string; label: string };

/** The message item or album item that holds this message. */
export function itemHoldsMessage(item: MessageListItem, messageId: string): boolean {
  if (item.type === 'message') return item.message.id === messageId;
  if (item.type === 'album') return item.messages.some((m) => m.id === messageId);
  return false;
}

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

  for (const entry of groupAlbumRuns(messages, albumKeyOf, (m) => m.attachment?.album?.index ?? 0)) {
    const message = Array.isArray(entry) ? entry[0]! : entry;
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

    if (Array.isArray(entry)) {
      items.push({ type: 'album', id: `album-${message.id}`, messages: entry });
    } else {
      items.push({
        type: 'message',
        id: message.id,
        message,
      });
    }
  }

  return items.reverse();
}
