import { groupDecrypt, groupEncrypt, protocolErrorCode, type GroupMessage } from '@velo/protocol';
import { groupPeerKey, type GroupView } from '../api/groups.api';
import { messagesApi, type HistoryItem } from '../api/messages.api';
import { ensureSocketConnected } from '../socket/socket';
import { loadPeerSenderKey, savePeerSenderKey, saveOwnSenderKey } from '../storage/senderKeyStore';
import { upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { distributeSenderKey, ensureOwnSenderKey, requestSenderKey } from './groupKeys';
import { reportDecryptFailure } from '../api/telemetry.api';

/**
 * Group messages on the device (T6.4). Sending: make sure every member has
 * our key, encrypt under our sender key, persist the advanced state, emit
 * `group:send`, store locally. Receiving: decrypt under the sender's stored
 * key, persist its advanced state, store locally, ack so the server deletes
 * our copy. A message from a member whose key we lack (or which is stale)
 * stays on the server and a key request goes to that member; the next sync
 * after the key arrives opens it.
 */

export type GroupSendAck = { ok: true; serverMessageId: string | null; seq: number | null; epoch: number } | { ok: false; code?: string; error?: string; epoch?: number };

export async function sendGroupMessage(params: { myUserId: string; group: GroupView; text: string; clientMessageId: string; createdAt: number }): Promise<{ stored: StoredMessage; ack: GroupSendAck }> {
  const { myUserId, group, text, clientMessageId, createdAt } = params;
  const peerKey = groupPeerKey(group.groupId);

  // Members without our key get it first (best effort; a member that could not be reached retries next send).
  await distributeSenderKey({ myUserId, group });
  const { state } = await ensureOwnSenderKey({ myUserId, groupId: group.groupId, epoch: group.epoch });
  const step = groupEncrypt(state, text, { groupId: group.groupId, senderUserId: myUserId });
  await saveOwnSenderKey(myUserId, group.groupId, { epoch: group.epoch, state: step.state });

  const socket = await ensureSocketConnected();
  const ack = await new Promise<GroupSendAck>((resolve) => {
    socket.emit('group:send', { groupId: group.groupId, clientMessageId, createdAt, epoch: group.epoch, g1: step.message }, (r: GroupSendAck) => resolve(r));
  });

  const stored: StoredMessage = {
    id: clientMessageId,
    clientMessageId,
    serverMessageId: ack.ok ? ack.serverMessageId : null,
    direction: 'out',
    senderUserId: myUserId,
    text,
    createdAt,
    seq: ack.ok ? ack.seq : null,
    status: ack.ok ? 'sent' : 'failed',
    deliveredAt: null,
    readAt: null,
    replyTo: null,
  };
  await upsertStoredMessage({ myUserId, peerUserId: peerKey, message: stored });
  return { stored, ack };
}

function groupMessageOf(it: HistoryItem): GroupMessage | null {
  const g = it.g1;
  if (!g || g.v !== 1 || typeof g.keyId !== 'number' || typeof g.iteration !== 'number' || typeof g.ciphertext !== 'string' || typeof g.signature !== 'string') return null;
  return { v: 1, keyId: g.keyId, iteration: g.iteration, ciphertext: g.ciphertext, signature: g.signature };
}

export type GroupIngestResult = { received: StoredMessage[]; waitingForKey: string[]; failed: Array<{ serverMessageId: string; code: string | null }> };

/**
 * Decrypt, store and ack group items (from the undelivered listing or a live
 * `message:new`). Items whose sender key is missing or stale are left on the
 * server and a key request is sent to that member.
 */
export async function ingestGroupItems(params: { myUserId: string; groupId: string; items: HistoryItem[]; onSecurityWarning?: (code: string, fromUserId: string) => void }): Promise<GroupIngestResult> {
  const { myUserId, groupId, items } = params;
  const peerKey = groupPeerKey(groupId);
  const received: StoredMessage[] = [];
  const waitingForKey: string[] = [];
  const failed: GroupIngestResult['failed'] = [];
  const acked: string[] = [];

  for (const it of items) {
    if (String(it.groupId ?? '') !== groupId) continue;
    const fromUserId = String(it.fromUserId);
    if (fromUserId === myUserId) continue;
    const message = groupMessageOf(it);
    if (!message) continue;
    const state = await loadPeerSenderKey(myUserId, groupId, fromUserId);
    if (!state) {
      if (!waitingForKey.includes(fromUserId)) waitingForKey.push(fromUserId);
      await requestSenderKey({ myUserId, groupId, fromUserId });
      continue;
    }
    try {
      const r = groupDecrypt(state, message, { groupId, senderUserId: fromUserId });
      await savePeerSenderKey(myUserId, groupId, fromUserId, r.state);
      const stored: StoredMessage = {
        id: it.clientMessageId || it.serverMessageId,
        clientMessageId: it.clientMessageId ?? null,
        serverMessageId: it.serverMessageId,
        direction: 'in',
        senderUserId: fromUserId,
        text: r.plaintext,
        createdAt: Number(it.createdAt ?? Date.now()),
        seq: typeof it.seq === 'number' ? it.seq : null,
        status: it.status ?? 'sent',
        deliveredAt: null,
        readAt: null,
        replyTo: null,
      };
      await upsertStoredMessage({ myUserId, peerUserId: peerKey, message: stored });
      received.push(stored);
      acked.push(it.serverMessageId);
    } catch (e) {
      const code = protocolErrorCode(e);
      if (code === 'SENDER_KEY_STALE') {
        if (!waitingForKey.includes(fromUserId)) waitingForKey.push(fromUserId);
        await requestSenderKey({ myUserId, groupId, fromUserId });
      } else if (code === 'REPLAY_DETECTED' || code === 'UNKNOWN_OLD_MESSAGE') {
        acked.push(it.serverMessageId); // consumed already: nothing left to fetch
      } else {
        failed.push({ serverMessageId: it.serverMessageId, code });
        if (code === 'SENDER_KEY_SIGNATURE_INVALID') params.onSecurityWarning?.(code, fromUserId);
        reportDecryptFailure(code);
      }
    }
  }

  if (acked.length) {
    try {
      await messagesApi.ackDelivered(acked);
    } catch (e) {
      console.warn('[groups] delivered ack failed (will retry next sync):', e);
    }
  }
  return { received, waitingForKey, failed };
}

/** Pull everything the server still holds for this group and ingest it. */
export async function syncGroupFromServer(params: { myUserId: string; groupId: string; onSecurityWarning?: (code: string, fromUserId: string) => void }): Promise<GroupIngestResult> {
  const res = await messagesApi.getUndelivered({ groupId: params.groupId, limit: 100 });
  const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
  return ingestGroupItems({ myUserId: params.myUserId, groupId: params.groupId, items, onSecurityWarning: params.onSecurityWarning });
}
