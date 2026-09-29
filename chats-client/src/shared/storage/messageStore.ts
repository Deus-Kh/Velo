import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { openJson, sealJson } from './sealed';
import type { ReplyReference } from '../chat/types';
import { loadConversationSettings } from './conversationSettingsStore';

/**
 * Local encrypted message store (T2.14, decision D7 = A: sealed records in
 * AsyncStorage, no native database). Each message is one record sealed
 * under the per-user session master key (XSalsa20-Poly1305, key in the
 * Keychain), so plaintext never touches disk unencrypted.
 *
 * Messages are decrypted once, stored here, and the message key is deleted
 * (forward secrecy at rest). History is read from here; the server is only
 * asked for messages newer than the latest stored one.
 *
 * Record keys sort by time: msg:v1:<me>:<peer>:<createdAt padded>:<id>.
 * The id is the client message id when there is one (stable across the
 * send/ack cycle), otherwise the server id.
 */
export type StoredMessage = {
  id: string;
  serverMessageId: string | null;
  clientMessageId: string | null;
  direction: 'in' | 'out';
  /** T6.4: the sender of a group message (null/absent for 1:1, where the peer is implied by the key). */
  senderUserId?: string | null;
  text: string;
  /** Sender's clock: the record key and the paging cursor (display order within a device). */
  createdAt: number;
  /** T3.2: server-assigned per-conversation order; null until the send is acked or on pre-T3.2 records. */
  seq: number | null;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt: number | null;
  readAt: number | null;
  replyTo: ReplyReference | null;
  /** T7.2: reactions by user id; edit/delete times (a deleted message is a tombstone with empty text); forward provenance. */
  reactions?: Record<string, string> | null;
  editedAt?: number | null;
  deletedAt?: number | null;
  forwardedFrom?: { userId: string; createdAt: number } | null;
  /** T7.3: a system line (timer change), shown centred, never expires. */
  system?: boolean;
  /** T7.3: when this record is removed by the sweeper; fixed when first stored; null = never. */
  expiresAt?: number | null;
};

const PREFIX = 'msg:v1';

function pairPrefix(myUserId: string, peerUserId: string) {
  return `${PREFIX}:${myUserId}:${peerUserId}:`;
}

function recordKey(myUserId: string, peerUserId: string, message: Pick<StoredMessage, 'id' | 'createdAt'>) {
  return `${pairPrefix(myUserId, peerUserId)}${String(Math.max(0, Math.floor(message.createdAt))).padStart(15, '0')}:${message.id}`;
}

function createdAtFromKey(key: string, prefix: string): number {
  return Number(key.slice(prefix.length, prefix.length + 15));
}

export function storedMessageId(message: { clientMessageId?: string | null; serverMessageId?: string | null }): string {
  return message.clientMessageId || message.serverMessageId || '';
}

export async function upsertStoredMessage(params: { myUserId: string; peerUserId: string; message: StoredMessage }): Promise<void> {
  const { myUserId, peerUserId } = params;
  const message: StoredMessage = { ...params.message };
  if (!message.id) return;
  const mk = await getOrCreateSessionMasterKey(myUserId);
  const key = recordKey(myUserId, peerUserId, message);
  if (message.expiresAt === undefined) {
    // T7.3: the expiry is fixed when the record is first stored (send time for ours, now for the peer's);
    // a later update (status, edit) keeps it.
    const prev = openJson<StoredMessage>(mk, await AsyncStorage.getItem(key));
    if (prev && prev.expiresAt !== undefined) message.expiresAt = prev.expiresAt;
    else if (message.system) message.expiresAt = null;
    else {
      const settings = await loadConversationSettings(myUserId, peerUserId);
      message.expiresAt = settings.timerSeconds ? (message.direction === 'out' ? message.createdAt : Date.now()) + settings.timerSeconds * 1000 : null;
    }
  }
  await AsyncStorage.setItem(key, sealJson(mk, message));
}

/**
 * Update fields of one stored record (delivery/read state). Returns the
 * updated record, or null when there is no such record on this device.
 */
export async function patchStoredMessage(params: {
  myUserId: string;
  peerUserId: string;
  id: string;
  createdAt: number;
  patch: Partial<Omit<StoredMessage, 'id' | 'createdAt' | 'direction' | 'clientMessageId'>>;
}): Promise<StoredMessage | null> {
  const { myUserId, peerUserId } = params;
  const key = recordKey(myUserId, peerUserId, { id: params.id, createdAt: params.createdAt });
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const mk = await getOrCreateSessionMasterKey(myUserId);
  const current = openJson<StoredMessage>(mk, raw);
  if (!current) return null;
  const next: StoredMessage = { ...current, ...params.patch };
  await AsyncStorage.setItem(key, sealJson(mk, next));
  return next;
}

/** T7.2: one record by its id (the sender's client id), without knowing its time. Keys only until the match. */
export async function findStoredMessage(params: { myUserId: string; peerUserId: string; id: string }): Promise<StoredMessage | null> {
  if (!params.id) return null;
  const prefix = pairPrefix(params.myUserId, params.peerUserId);
  const suffix = ':' + params.id;
  const key = (await AsyncStorage.getAllKeys()).find((k) => k.startsWith(prefix) && k.endsWith(suffix));
  if (!key) return null;
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  return openJson<StoredMessage>(mk, raw);
}

/** T7.2: "delete for me". */
export async function deleteStoredMessage(params: { myUserId: string; peerUserId: string; id: string; createdAt: number }): Promise<void> {
  await AsyncStorage.removeItem(recordKey(params.myUserId, params.peerUserId, { id: params.id, createdAt: params.createdAt }));
}

/** Newest page first by key order, returned oldest → newest. `before` excludes messages at or after that time. */
export async function listStoredMessages(params: {
  myUserId: string;
  peerUserId: string;
  limit: number;
  before?: number | null;
}): Promise<StoredMessage[]> {
  const { myUserId, peerUserId, limit } = params;
  const prefix = pairPrefix(myUserId, peerUserId);
  const keys = (await AsyncStorage.getAllKeys())
    .filter((k) => k.startsWith(prefix))
    .filter((k) => (params.before == null ? true : createdAtFromKey(k, prefix) < params.before))
    .sort()
    .reverse()
    .slice(0, Math.max(0, limit));
  if (keys.length === 0) return [];

  const mk = await getOrCreateSessionMasterKey(myUserId);
  const rows = await AsyncStorage.multiGet(keys);
  const out: StoredMessage[] = [];
  for (const [, raw] of rows) {
    const m = openJson<StoredMessage>(mk, raw);
    if (m && typeof m.text === 'string' && typeof m.createdAt === 'number') out.push(m);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Latest createdAt stored for the pair, or null. Read from the keys only (no decryption). */
export async function latestStoredCreatedAt(params: { myUserId: string; peerUserId: string }): Promise<number | null> {
  const prefix = pairPrefix(params.myUserId, params.peerUserId);
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) return null;
  return keys.reduce((max, k) => Math.max(max, createdAtFromKey(k, prefix)), 0);
}

export async function countStoredMessages(params: { myUserId: string; peerUserId: string }): Promise<number> {
  const prefix = pairPrefix(params.myUserId, params.peerUserId);
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)).length;
}

export async function deleteStoredMessagesForPair(params: { myUserId: string; peerUserId: string }): Promise<void> {
  const prefix = pairPrefix(params.myUserId, params.peerUserId);
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

/** Prefix for a logout wipe of every conversation of a user. */
export function storedMessagesPrefixForUser(myUserId: string): string {
  return `${PREFIX}:${myUserId}:`;
}
