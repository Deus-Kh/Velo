import { groupDecryptContent, groupEncryptContent, protocolErrorCode, textContent, type Content, type GroupMessage } from '@velo/protocol';
import { handleInboundAction } from './actions';
import { groupPeerKey, type GroupView } from '../api/groups.api';
import { messagesApi, type HistoryItem } from '../api/messages.api';
import { ensureSocketConnected } from '../socket/socket';
import { loadPeerSenderKey, savePeerSenderKey, saveOwnSenderKey } from '../storage/senderKeyStore';
import { upsertStoredMessage, type AttachmentMeta, type StoredMessage } from '../storage/messageStore';
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

/** Encrypt one envelope under our sender key and emit `group:send`; members lacking our key get it first (best effort). */
async function sendGroupEnvelope(params: { myUserId: string; group: GroupView; content: Content; clientMessageId: string; createdAt: number }): Promise<GroupSendAck> {
  const { myUserId, group, content, clientMessageId, createdAt } = params;
  await distributeSenderKey({ myUserId, group });
  const { state } = await ensureOwnSenderKey({ myUserId, groupId: group.groupId, epoch: group.epoch });
  const step = groupEncryptContent(state, content, { groupId: group.groupId, senderUserId: myUserId }); // T7.1 envelope
  await saveOwnSenderKey(myUserId, group.groupId, { epoch: group.epoch, state: step.state });
  const socket = await ensureSocketConnected();
  return new Promise<GroupSendAck>((resolve) => {
    socket.emit('group:send', { groupId: group.groupId, clientMessageId, createdAt, epoch: group.epoch, g1: step.message }, (r: GroupSendAck) => resolve(r));
  });
}

/** T7.2: an action (reaction, edit, delete request, timer) on the group chain; nothing is stored as a message. */
export async function sendGroupContent(params: { myUserId: string; group: GroupView; content: Content }): Promise<GroupSendAck> {
  return sendGroupEnvelope({ ...params, clientMessageId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: Date.now() });
}

/** T8.3: an attachment (or any content shown as a message) on the group chain, stored locally with its meta. */
export async function sendGroupContentMessage(params: { myUserId: string; group: GroupView; content: Content; text: string; attachment: AttachmentMeta | null; clientMessageId: string; createdAt: number }): Promise<{ stored: StoredMessage; ack: GroupSendAck }> {
  const { myUserId, group, content, clientMessageId, createdAt } = params;
  const peerKey = groupPeerKey(group.groupId);
  const ack = await sendGroupEnvelope({ myUserId, group, content, clientMessageId, createdAt });
  const stored: StoredMessage = {
    id: clientMessageId,
    clientMessageId,
    serverMessageId: ack.ok ? ack.serverMessageId : null,
    direction: 'out',
    senderUserId: myUserId,
    text: params.text,
    createdAt,
    seq: ack.ok ? ack.seq : null,
    status: ack.ok ? 'sent' : 'failed',
    deliveredAt: null,
    readAt: null,
    replyTo: null,
    attachment: params.attachment,
  };
  await upsertStoredMessage({ myUserId, peerUserId: peerKey, message: stored });
  return { stored, ack };
}

export async function sendGroupMessage(params: { myUserId: string; group: GroupView; text: string; clientMessageId: string; createdAt: number; forwardedFrom?: { userId: string; createdAt: number } | null }): Promise<{ stored: StoredMessage; ack: GroupSendAck }> {
  const { myUserId, group, text, clientMessageId, createdAt } = params;
  const peerKey = groupPeerKey(group.groupId);
  const ack = await sendGroupEnvelope({ myUserId, group, content: textContent(text, params.forwardedFrom ?? undefined), clientMessageId, createdAt });

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
    forwardedFrom: params.forwardedFrom ?? null,
  };
  await upsertStoredMessage({ myUserId, peerUserId: peerKey, message: stored });
  return { stored, ack };
}

function groupMessageOf(it: HistoryItem): GroupMessage | null {
  const g = it.g1;
  if (!g || g.v !== 1 || typeof g.keyId !== 'number' || typeof g.iteration !== 'number' || typeof g.ciphertext !== 'string' || typeof g.signature !== 'string') return null;
  return { v: 1, keyId: g.keyId, iteration: g.iteration, ciphertext: g.ciphertext, signature: g.signature };
}

export type GroupIngestResult = { received: StoredMessage[]; waitingForKey: string[]; failed: Array<{ serverMessageId: string; code: string | null }>; dropped: string[] };

/**
 * Decrypt, store and ack group items (from the undelivered listing or a live
 * `message:new`). Items whose sender key is missing or stale are left on the
 * server and a key request is sent to that member.
 *
 * T6.5: with `memberIds` known, a copy from someone who is no longer a member
 * is dropped (acked, never stored) and no key is requested from them: a
 * removed member's key is dead, and asking would hand our own key back over
 * the pairwise session in reply.
 */
export async function ingestGroupItems(params: {
  myUserId: string;
  groupId: string;
  items: HistoryItem[];
  memberIds?: string[] | null;
  /** T7.3: who may change the timer; unknown (null) refuses timer changes. */
  adminIds?: string[] | null;
  onSecurityWarning?: (code: string, fromUserId: string) => void;
}): Promise<GroupIngestResult> {
  const { myUserId, groupId, items } = params;
  const members = params.memberIds ? new Set(params.memberIds) : null;
  const peerKey = groupPeerKey(groupId);
  const received: StoredMessage[] = [];
  const waitingForKey: string[] = [];
  const failed: GroupIngestResult['failed'] = [];
  const dropped: string[] = [];
  const acked: string[] = [];

  for (const it of items) {
    if (String(it.groupId ?? '') !== groupId) continue;
    const fromUserId = String(it.fromUserId);
    if (fromUserId === myUserId) continue;
    const message = groupMessageOf(it);
    if (!message) continue;
    if (members && !members.has(fromUserId)) {
      dropped.push(it.serverMessageId);
      acked.push(it.serverMessageId);
      continue;
    }
    const state = await loadPeerSenderKey(myUserId, groupId, fromUserId);
    if (!state) {
      if (!waitingForKey.includes(fromUserId)) waitingForKey.push(fromUserId);
      await requestSenderKey({ myUserId, groupId, fromUserId });
      continue;
    }
    try {
      const r = groupDecryptContent(state, message, { groupId, senderUserId: fromUserId });
      await savePeerSenderKey(myUserId, groupId, fromUserId, r.state);
      if (r.content.kind !== 'text' && r.content.kind !== 'attachment') {
        await handleInboundAction({ myUserId, peerKey, actorUserId: fromUserId, content: r.content, groupAdminIds: params.adminIds ?? null }); // T7.2 / T7.3
        acked.push(it.serverMessageId);
        continue;
      }
      const c = r.content;
      const stored: StoredMessage = {
        id: it.clientMessageId || it.serverMessageId,
        clientMessageId: it.clientMessageId ?? null,
        serverMessageId: it.serverMessageId,
        direction: 'in',
        senderUserId: fromUserId,
        text: c.kind === 'attachment' ? (c.caption ?? '') : c.text,
        createdAt: Number(it.createdAt ?? Date.now()),
        seq: typeof it.seq === 'number' ? it.seq : null,
        status: it.status ?? 'sent',
        deliveredAt: null,
        readAt: null,
        replyTo: null,
        forwardedFrom: c.kind === 'text' ? (c.forwardedFrom ?? null) : null,
        attachment: c.kind === 'attachment' ? { blobId: c.blobId, key: c.key, digest: c.digest, size: c.size, contentType: c.contentType, ...(c.width !== undefined ? { width: c.width } : {}), ...(c.height !== undefined ? { height: c.height } : {}), ...(c.durationMs !== undefined ? { durationMs: c.durationMs } : {}), ...(c.name !== undefined ? { name: c.name } : {}) } : null, // T8.3
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
  return { received, waitingForKey, failed, dropped };
}

/** Pull everything the server still holds for this group and ingest it. */
export async function syncGroupFromServer(params: { myUserId: string; groupId: string; memberIds?: string[] | null; adminIds?: string[] | null; onSecurityWarning?: (code: string, fromUserId: string) => void }): Promise<GroupIngestResult> {
  const res = await messagesApi.getUndelivered({ groupId: params.groupId, limit: 100 });
  const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
  return ingestGroupItems({ myUserId: params.myUserId, groupId: params.groupId, items, memberIds: params.memberIds, adminIds: params.adminIds, onSecurityWarning: params.onSecurityWarning });
}
