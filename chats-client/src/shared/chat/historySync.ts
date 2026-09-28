import { normalizeB64, protocolErrorCode, type MessageEnvelope } from '@velo/protocol';
import { messagesApi, type HistoryItem } from '../api/messages.api';
import { deleteV2MessageKeysForPair, hasArchivedKeysForPair } from '../storage/v2MessageKeyStore';
import { latestStoredCreatedAt, storedMessageId, upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { receiveIncoming } from './incoming';
import { decryptArchived } from './ratchetAdapter';

const SYNC_PAGE = 200;
const MAX_PAGES = 20;

function envelopeOf(it: HistoryItem): MessageEnvelope | null {
  const h = it.v3?.header;
  if (!h || typeof h.n !== 'number' || typeof h.pn !== 'number' || typeof h.dhPub !== 'string') return null;
  if (typeof it.v3?.ciphertext !== 'string' || typeof it.v3?.mac !== 'string') return null;
  return { header: { n: h.n, pn: h.pn, dhPub: normalizeB64(h.dhPub) }, ciphertext: normalizeB64(it.v3.ciphertext), mac: normalizeB64(it.v3.mac) };
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
    status: it.status ?? 'sent',
    deliveredAt: it.deliveredAt ?? null,
    readAt: it.readAt ?? null,
    replyTo: it.replyTo ?? null,
  };
}

/**
 * Pull messages the server holds that are newer than the latest stored one
 * (T2.14; T3.1 replaces this with an undelivered endpoint). Inbound items
 * are bootstrapped/decrypted through the normal receive path and stored;
 * our own items from another install cannot be decrypted and are skipped.
 * Returns the stored messages in ascending order.
 */
export async function syncNewerFromServer(params: {
  myUserId: string;
  peerUserId: string;
  onIdentityChanged: (reason: string) => void;
  onResetRequired: (reason: string) => void;
}): Promise<StoredMessage[]> {
  const { myUserId, peerUserId } = params;
  const out: StoredMessage[] = [];
  let after = (await latestStoredCreatedAt({ myUserId, peerUserId })) ?? 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await messagesApi.getWithUser(peerUserId, { limit: SYNC_PAGE, after });
    const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
    items.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
    if (items.length === 0) break;

    for (const it of items) {
      const createdAt = Number(it.createdAt ?? 0);
      if (createdAt > after) after = createdAt;
      const mine = String(it.fromUserId) === String(myUserId);
      if (mine || it.protoVersion !== 3) continue;
      const envelope = envelopeOf(it);
      if (!envelope) continue;
      try {
        const r = await receiveIncoming({ myUserId, peerUserId, initPacket: it.initPacket ?? null, encrypted: envelope });
        const stored = toStored(it, 'in', r.plaintext);
        if (stored) {
          await upsertStoredMessage({ myUserId, peerUserId, message: stored });
          out.push(stored);
        }
      } catch (e) {
        const code = protocolErrorCode(e);
        if (code === 'IDENTITY_MISMATCH') params.onIdentityChanged('initiator identity does not match the pinned identity');
        else if (code === 'MISSING_BOOTSTRAP' || code === 'SESSION_RESET_REQUIRED') params.onResetRequired('missing session and initPacket for inbound history item');
        else if (code !== 'REPLAY_DETECTED') console.warn('History sync: message not decryptable', { serverMessageId: it.serverMessageId, code });
      }
    }
    if (items.length < SYNC_PAGE) break;
  }
  return out;
}

/**
 * One-time migration from the pre-T2.14 archive: decrypt every server
 * message this device holds an archived key for, store the plaintext, then
 * delete the archive for the pair. Idempotent: does nothing once the
 * archive is gone.
 */
export async function migrateArchivedHistory(params: { myUserId: string; peerUserId: string }): Promise<number> {
  const { myUserId, peerUserId } = params;
  if (!(await hasArchivedKeysForPair({ myUserId, peerUserId }))) return 0;

  let migrated = 0;
  let before: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await messagesApi.getWithUser(peerUserId, { limit: SYNC_PAGE, before: before ?? undefined });
    const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
    if (items.length === 0) break;
    for (const it of items) {
      const createdAt = Number(it.createdAt ?? 0);
      if (before === null || createdAt < before) before = createdAt;
      if (it.protoVersion !== 3) continue;
      const envelope = envelopeOf(it);
      if (!envelope) continue;
      const mine = String(it.fromUserId) === String(myUserId);
      try {
        const text = await decryptArchived({ myUserId, peerUserId, direction: mine ? 'out' : 'in', encrypted: envelope });
        if (text === null) continue;
        const stored = toStored(it, mine ? 'out' : 'in', text);
        if (stored) {
          await upsertStoredMessage({ myUserId, peerUserId, message: stored });
          migrated += 1;
        }
      } catch {
        /* an archived key that no longer opens: skip */
      }
    }
    if (items.length < SYNC_PAGE) break;
  }
  await deleteV2MessageKeysForPair({ myUserId, peerUserId });
  return migrated;
}
