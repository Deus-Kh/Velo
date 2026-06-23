import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReplyReference } from '../chat/types';

export type PendingMessageErrorCode =
  | 'send_failed'
  | 'socket_unavailable'
  | 'missing_bootstrap'
  | 'no_session'
  | 'decrypt_failed'
  | 'storage_corruption'
  | 'unknown';

export type PendingMessageRecord = {
  clientMessageId: string;
  toUserId: string;
  text: string;
  createdAt: number;
  replyTo?: ReplyReference | null;
  attempts: number;
  lastErrorCode: PendingMessageErrorCode | null;
};

function key(myUserId: string) {
  return `pending_messages_v1:${myUserId}`;
}

async function readAll(myUserId: string): Promise<PendingMessageRecord[]> {
  const raw = await AsyncStorage.getItem(key(myUserId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

async function writeAll(myUserId: string, items: PendingMessageRecord[]) {
  await AsyncStorage.setItem(key(myUserId), JSON.stringify(items));
}

export async function listPendingMessages(myUserId: string): Promise<PendingMessageRecord[]> {
  const items = await readAll(myUserId);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function upsertPendingMessage(
  myUserId: string,
  item: PendingMessageRecord
): Promise<void> {
  const items = await readAll(myUserId);
  const idx = items.findIndex((entry) => entry.clientMessageId === item.clientMessageId);

  if (idx === -1) {
    items.push(item);
  } else {
    items[idx] = item;
  }

  await writeAll(myUserId, items);
}

export async function removePendingMessage(
  myUserId: string,
  clientMessageId: string
): Promise<void> {
  const items = await readAll(myUserId);
  const next = items.filter((item) => item.clientMessageId !== clientMessageId);
  await writeAll(myUserId, next);
}

export async function removePendingMessagesForPair(
  myUserId: string,
  peerUserId: string
): Promise<void> {
  const items = await readAll(myUserId);
  const next = items.filter((item) => item.toUserId !== peerUserId);
  await writeAll(myUserId, next);
}
