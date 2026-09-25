import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReplyReference } from '../chat/types';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { looksSealed, openJson, sealJson } from './sealed';

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

/**
 * The queue holds PLAINTEXT bodies of messages not yet sent, so it is sealed
 * under the session master key (T1.3). A pre-T1.3 plaintext array is
 * migrated in place on first read.
 */
async function readAll(myUserId: string): Promise<PendingMessageRecord[]> {
  const raw = await AsyncStorage.getItem(key(myUserId));
  if (!raw) return [];

  const mk = await getOrCreateSessionMasterKey(myUserId);

  if (looksSealed(raw)) {
    const items = openJson<unknown>(mk, raw);
    return Array.isArray(items) ? (items.filter(Boolean) as PendingMessageRecord[]) : [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? (parsed.filter(Boolean) as PendingMessageRecord[]) : [];
  await AsyncStorage.setItem(key(myUserId), sealJson(mk, items)); // migrate legacy plaintext
  return items;
}

async function writeAll(myUserId: string, items: PendingMessageRecord[]) {
  const mk = await getOrCreateSessionMasterKey(myUserId);
  await AsyncStorage.setItem(key(myUserId), sealJson(mk, items));
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
