import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeB64, protocolErrorCode, decodeContent, isControlContent, type Content, type MessageEnvelope, type ProtocolErrorCode } from '@velo/protocol';
import { messagesApi, type HistoryItem, type ReceiptItem } from '../api/messages.api';
import { patchStoredMessage, storedMessageId, upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { receiveIncoming } from './incoming';
import { reportDecryptFailure } from '../api/telemetry.api';
import { publishControlContent } from '../socket/messaging';

const SYNC_PAGE = 100;
const MAX_PAGES = 20;

/** Receipt cursor per pair (server time of the last sync). Not secret. */
export function receiptsCursorKey(myUserId: string, peerUserId: string): string {
  return `msgsync:v1:${myUserId}:${peerUserId}`;
}

export function envelopeOf(it: Pick<HistoryItem, 'v4'>): MessageEnvelope | null {
  const e = it.v4;
  if (!e || typeof e.encHeader !== 'string' || typeof e.ciphertext !== 'string' || typeof e.mac !== 'string') return null;
  return { encHeader: normalizeB64(e.encHeader), ciphertext: normalizeB64(e.ciphertext), mac: normalizeB64(e.mac) };
}

function toStored(it: HistoryItem, direction: 'in' | 'out', text: string): StoredMessage | null {
  const clientMessageId = it.clientMessageId ?? null;
  const serverMessageId = it.serverMessageId || null;
  const id = storedMessageId({ clientMessageId, serverMessageId });
  if (!id) return null;
  return {
    id,
    serverMessageId,
    clientMessageId,
    direction,
    text,
    createdAt: Number(it.createdAt ?? Date.now()),
    seq: typeof it.seq === 'number' ? it.seq : null,
    status: it.status ?? 'sent',
    deliveredAt: it.deliveredAt ?? null,
    readAt: it.readAt ?? null,
    replyTo: it.replyTo ?? null,
  };
}

export type IngestCallbacks = {
  onIdentityChanged?: (reason: string, code: ProtocolErrorCode) => void;
  onResetRequired?: (reason: string, code: ProtocolErrorCode) => void;
  /** T4.8: a message that failed for another reason (shown, not swallowed). */
  onDecryptFailure?: (reason: string, code: ProtocolErrorCode) => void;
  /** T6.2: control content (sender-key distributions and requests) found while ingesting. */
  onControl?: (content: Content, meta: { fromUserId: string; serverMessageId: string }) => void;
};

/**
 * The one inbound ingest path (T3.1/T3.3): decrypt each item from `peerUserId`
 * through the T2.11 receive path, store the plaintext, and ack so the server
 * deletes the ciphertext. The ack is sent only for messages this device now
 * holds (or has already consumed): a message that fails to decrypt is left on
 * the server for a retry after the user acts. Used by the chat's history
 * sync, by the chat list for messages of chats that are not open, and by the
 * push wake-up.
 */
export async function ingestUndeliveredItems(params: {
  myUserId: string;
  peerUserId: string;
  items: HistoryItem[];
  callbacks?: IngestCallbacks;
}): Promise<{ received: StoredMessage[]; ackedIds: string[] }> {
  const { myUserId, peerUserId, items, callbacks } = params;
  const received: StoredMessage[] = [];
  const acked: string[] = [];

  for (const it of items) {
    if (String(it.fromUserId) === String(myUserId) || it.protoVersion !== 4) continue;
    if (it.g1 || it.groupId) continue; // T6.3: a group copy; the group paths ingest it
    const envelope = envelopeOf(it);
    if (!envelope) continue;
    try {
      const r = await receiveIncoming({ myUserId, peerUserId, initPacket: it.initPacket ?? null, encrypted: envelope });
      const content = decodeContent(r.plaintext); // T6.2
      if (content.kind !== 'text' && !isControlContent(content)) {
        acked.push(it.serverMessageId); // T7.1: an action; applied by T7.2
        continue;
      }
      if (isControlContent(content)) {
        callbacks?.onControl?.(content, { fromUserId: peerUserId, serverMessageId: it.serverMessageId });
        publishControlContent(content, { fromUserId: peerUserId, serverMessageId: it.serverMessageId });
        acked.push(it.serverMessageId);
        continue;
      }
      const record = toStored(it, 'in', content.text);
      if (record) {
        await upsertStoredMessage({ myUserId, peerUserId, message: record });
        received.push(record);
        acked.push(it.serverMessageId);
      }
    } catch (e) {
      const code = protocolErrorCode(e);
      if (code === 'IDENTITY_MISMATCH') callbacks?.onIdentityChanged?.('initiator identity does not match the pinned identity', code);
      else if (code === 'MISSING_BOOTSTRAP' || code === 'SESSION_RESET_REQUIRED') callbacks?.onResetRequired?.('missing session and initPacket for inbound history item', code);
      else if (code === 'REPLAY_DETECTED' || code === 'UNKNOWN_OLD_MESSAGE') acked.push(it.serverMessageId); // already consumed: nothing left to fetch
      else {
        console.warn('Ingest: message not decryptable', { serverMessageId: it.serverMessageId, code });
        if (code) callbacks?.onDecryptFailure?.('a stored message could not be decrypted', code);
      }
      if (code !== 'REPLAY_DETECTED' && code !== 'UNKNOWN_OLD_MESSAGE') reportDecryptFailure(code); // T4.6: the code only
    }
  }

  // The server deletes the ciphertext of what this device now holds.
  if (acked.length) {
    try {
      await messagesApi.ackDelivered(acked);
    } catch (e) {
      console.warn('Ingest: delivered ack failed (will retry next sync):', e);
    }
  }
  return { received, ackedIds: acked };
}

export type SyncResult = {
  /** Inbound messages decrypted and stored by this sync, ascending. */
  received: StoredMessage[];
  /** Own messages whose delivery/read state changed while this device was away. */
  updated: StoredMessage[];
};

/**
 * T3.1: pull what the server still holds for this pair. Undelivered inbound
 * messages go through `ingestUndeliveredItems`; receipts for our own messages
 * update the stored copies. Nothing is fetched twice: delivered ciphertext is
 * gone.
 */
export async function syncNewerFromServer(params: {
  myUserId: string;
  peerUserId: string;
  onIdentityChanged: (reason: string, code: ProtocolErrorCode) => void;
  onResetRequired: (reason: string, code: ProtocolErrorCode) => void;
  onDecryptFailure?: (reason: string, code: ProtocolErrorCode) => void;
}): Promise<SyncResult> {
  const { myUserId, peerUserId } = params;
  const received: StoredMessage[] = [];
  const updated: StoredMessage[] = [];
  const cursorKey = receiptsCursorKey(myUserId, peerUserId);
  let receiptsSince = 0;
  try {
    receiptsSince = Number((await AsyncStorage.getItem(cursorKey)) ?? 0) || 0;
  } catch {
    receiptsSince = 0;
  }

  let after: number | undefined;
  let serverTime: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await messagesApi.getUndelivered({
      peerUserId,
      limit: SYNC_PAGE,
      after,
      receiptsSince: page === 0 ? receiptsSince : undefined,
    });
    const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
    const receipts: ReceiptItem[] = page === 0 && Array.isArray(res.data?.receipts) ? res.data.receipts : [];
    if (typeof res.data?.serverTime === 'number') serverTime = res.data.serverTime;

    for (const r of receipts) {
      const id = storedMessageId({ clientMessageId: r.clientMessageId, serverMessageId: r.serverMessageId });
      if (!id) continue;
      const patched = await patchStoredMessage({
        myUserId,
        peerUserId,
        id,
        createdAt: r.createdAt,
        patch: {
          serverMessageId: r.serverMessageId,
          seq: typeof r.seq === 'number' ? r.seq : undefined,
          status: r.status,
          deliveredAt: r.deliveredAt ?? null,
          readAt: r.readAt ?? null,
        },
      });
      if (patched) updated.push(patched);
    }

    for (const it of items) {
      if (typeof it.seq === 'number') after = Math.max(after ?? 0, it.seq); // T3.2: the cursor is the server sequence
    }
    const ingested = await ingestUndeliveredItems({
      myUserId,
      peerUserId,
      items,
      callbacks: { onIdentityChanged: params.onIdentityChanged, onResetRequired: params.onResetRequired, onDecryptFailure: params.onDecryptFailure },
    });
    received.push(...ingested.received);

    if (items.length < SYNC_PAGE || after === undefined) break; // no seq on this page: nothing to page on
  }

  if (serverTime !== null) {
    try {
      await AsyncStorage.setItem(cursorKey, String(serverTime));
    } catch {
      /* cursor is a convenience; receipts are idempotent */
    }
  }
  return { received, updated };
}
