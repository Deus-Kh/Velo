import { isActionContent, textContent, type ActionContent, type Content, type MessageRef } from '@velo/protocol';
import { groupPeerKey, type GroupView } from '../api/groups.api';
import { ensureV2Session } from '../crypto/sessionBootstrap';
import { sendContent, sendMessageV2 } from '../socket/messaging';
import { deleteStoredMessage, findStoredMessage, patchStoredMessage, upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { sendGroupContent, sendGroupMessage } from './groupMessaging';
import { handleInboundTimer } from './disappearing';
import { applyInboundProfile } from './profile';
import { deleteMedia } from '../media/mediaStore';

/**
 * Message actions (T7.2): reactions, edits, "delete for everyone" and
 * forwarding. An action is content inside the authenticated session (T7.1);
 * the receiver applies it to its own sealed store, and only the target's
 * sender may edit or delete. Nothing here touches the server beyond the
 * opaque ciphertext the session already carries.
 *
 * Every inbound path (live 1:1, undelivered ingest, push wake-up, group live
 * and sync) ends in `handleInboundAction`; the UI learns of a changed record
 * through `subscribeToMessagePatches`.
 */

/** The local conversation slot: a peer's user id, or `group:<id>`. */
export type ConversationTarget = { kind: 'peer'; peerUserId: string } | { kind: 'group'; group: GroupView };

export function peerKeyOf(target: ConversationTarget): string {
  return target.kind === 'peer' ? target.peerUserId : groupPeerKey(target.group.groupId);
}

export type MessagePatch = { myUserId: string; peerKey: string; id: string; message: StoredMessage | null };
type PatchListener = (patch: MessagePatch) => void;
const patchListeners = new Set<PatchListener>();

export function subscribeToMessagePatches(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => {
    patchListeners.delete(listener);
  };
}

export function publishMessagePatch(patch: MessagePatch): void {
  for (const l of patchListeners) {
    try {
      l(patch);
    } catch (e) {
      console.warn('[actions] patch listener failed:', e);
    }
  }
}

/** Who sent a stored message: us for outgoing, the group sender or the peer for incoming. */
export function senderOf(message: StoredMessage, myUserId: string, peerKey: string): string | null {
  if (message.direction === 'out') return myUserId;
  if (message.senderUserId) return message.senderUserId;
  return peerKey.startsWith('group:') ? null : peerKey;
}

/** The reference both sides know for a stored message, or null when it cannot be named (no client id). */
export function messageRefOf(message: StoredMessage, myUserId: string, peerKey: string): MessageRef | null {
  const senderUserId = senderOf(message, myUserId, peerKey);
  if (!senderUserId || !message.clientMessageId) return null;
  return { senderUserId, clientMessageId: message.clientMessageId };
}

export type ApplyResult = { applied: true; message: StoredMessage } | { applied: false; reason: string };

/**
 * Apply one action to the local store. `actorUserId` is who sent it (the
 * authenticated peer, or us when applying our own before sending).
 */
export async function applyActionContent(params: { myUserId: string; peerKey: string; actorUserId: string; content: ActionContent; now?: number }): Promise<ApplyResult> {
  const { myUserId, peerKey, actorUserId, content } = params;
  const now = params.now ?? Date.now();
  if (content.kind === 'timer') return { applied: false, reason: 'timer is applied by the conversation settings (T7.3)' };
  if (content.kind === 'profile') return { applied: false, reason: 'a profile is applied by chat/profile.ts (T7.7)' };

  const found = await findStoredMessage({ myUserId, peerUserId: peerKey, id: content.target.clientMessageId });
  if (!found) return { applied: false, reason: 'target not stored on this device' };
  const sender = senderOf(found, myUserId, peerKey);
  if (sender !== content.target.senderUserId) return { applied: false, reason: 'target sender does not match' };

  let patch: Partial<StoredMessage>;
  if (content.kind === 'reaction') {
    if (found.deletedAt) return { applied: false, reason: 'target is deleted' };
    const reactions = { ...(found.reactions ?? {}) };
    if (content.remove) delete reactions[actorUserId];
    else reactions[actorUserId] = content.emoji;
    patch = { reactions };
  } else {
    if (actorUserId !== sender) return { applied: false, reason: 'only the sender may edit or delete' };
    if (content.kind === 'edit') {
      if (found.deletedAt) return { applied: false, reason: 'target is deleted' };
      patch = { text: content.text, editedAt: now };
    } else {
      patch = { text: '', deletedAt: now, editedAt: null, reactions: {}, attachment: null };
      if (found.attachment) await deleteMedia(myUserId, found.attachment.blobId); // T8.3: the tombstone keeps no media
    }
  }
  const next = await patchStoredMessage({ myUserId, peerUserId: peerKey, id: found.id, createdAt: found.createdAt, patch });
  if (!next) return { applied: false, reason: 'target vanished' };
  publishMessagePatch({ myUserId, peerKey, id: next.id, message: next });
  return { applied: true, message: next };
}

/** Every inbound path calls this for non-text, non-control content. Never throws. */
export async function handleInboundAction(params: { myUserId: string; peerKey: string; actorUserId: string; content: Content; groupAdminIds?: string[] | null }): Promise<void> {
  if (!isActionContent(params.content)) return;
  try {
    if (params.content.kind === 'profile') {
      await applyInboundProfile({ myUserId: params.myUserId, actorUserId: params.actorUserId, content: params.content }); // T7.7
      return;
    }
    if (params.content.kind === 'timer') {
      await handleInboundTimer({ myUserId: params.myUserId, peerKey: params.peerKey, actorUserId: params.actorUserId, content: params.content, groupAdminIds: params.groupAdminIds }); // T7.3
      return;
    }
    const r = await applyActionContent({ myUserId: params.myUserId, peerKey: params.peerKey, actorUserId: params.actorUserId, content: params.content });
    if (!r.applied) console.warn('[actions] inbound action not applied:', { kind: params.content.kind, reason: r.reason });
  } catch (e) {
    console.warn('[actions] inbound action failed:', e);
  }
}

// ───────── sending: apply locally first, then over the session ─────────

async function transport(myUserId: string, target: ConversationTarget, content: Content): Promise<void> {
  if (target.kind === 'peer') {
    await sendContent(target.peerUserId, content);
    return;
  }
  const ack = await sendGroupContent({ myUserId, group: target.group, content });
  if (!ack.ok) throw new Error(ack.code || ack.error || 'group send refused');
}

export async function sendAction(params: { myUserId: string; target: ConversationTarget; content: ActionContent }): Promise<ApplyResult> {
  const { myUserId, target, content } = params;
  const local = await applyActionContent({ myUserId, peerKey: peerKeyOf(target), actorUserId: myUserId, content });
  if (!local.applied) return local;
  await transport(myUserId, target, content);
  return local;
}

export async function reactToMessage(params: { myUserId: string; target: ConversationTarget; message: StoredMessage; emoji: string; remove?: boolean }): Promise<ApplyResult> {
  const ref = messageRefOf(params.message, params.myUserId, peerKeyOf(params.target));
  if (!ref) return { applied: false, reason: 'message cannot be referenced' };
  const content: ActionContent = params.remove ? { v: 1, kind: 'reaction', target: ref, emoji: params.emoji, remove: true } : { v: 1, kind: 'reaction', target: ref, emoji: params.emoji };
  return sendAction({ myUserId: params.myUserId, target: params.target, content });
}

export async function editMessage(params: { myUserId: string; target: ConversationTarget; message: StoredMessage; text: string }): Promise<ApplyResult> {
  const ref = messageRefOf(params.message, params.myUserId, peerKeyOf(params.target));
  if (!ref) return { applied: false, reason: 'message cannot be referenced' };
  const text = params.text.trim();
  if (!text) return { applied: false, reason: 'empty text' };
  return sendAction({ myUserId: params.myUserId, target: params.target, content: { v: 1, kind: 'edit', target: ref, text } });
}

/** A request: the other devices honour it; a copy may already have been read. */
export async function deleteForEveryone(params: { myUserId: string; target: ConversationTarget; message: StoredMessage }): Promise<ApplyResult> {
  const ref = messageRefOf(params.message, params.myUserId, peerKeyOf(params.target));
  if (!ref) return { applied: false, reason: 'message cannot be referenced' };
  return sendAction({ myUserId: params.myUserId, target: params.target, content: { v: 1, kind: 'delete', target: ref } });
}

/** Local only: the record is removed from this device. */
export async function deleteForMe(params: { myUserId: string; peerKey: string; message: StoredMessage }): Promise<void> {
  await deleteStoredMessage({ myUserId: params.myUserId, peerUserId: params.peerKey, id: params.message.id, createdAt: params.message.createdAt });
  if (params.message.attachment) await deleteMedia(params.myUserId, params.message.attachment.blobId); // T8.3
  publishMessagePatch({ myUserId: params.myUserId, peerKey: params.peerKey, id: params.message.id, message: null });
}

const genId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Forward a message's text to another conversation with its provenance
 * (the original author and time); the original author is not involved.
 */
export async function forwardMessage(params: { myUserId: string; fromPeerKey: string; message: StoredMessage; to: ConversationTarget }): Promise<StoredMessage> {
  const { myUserId, message, to } = params;
  if (message.deletedAt) throw new Error('nothing to forward');
  if (message.attachment) {
    // T8.3: the reference (id, key, digest) is forwarded; the blob is not re-uploaded while it lives.
    const { sendAttachmentMessage, contentOf } = await import('../media/attachments');
    return sendAttachmentMessage({ myUserId, target: to, content: contentOf(message.attachment, message.text) });
  }
  if (!message.text) throw new Error('nothing to forward');
  const originalSender = senderOf(message, myUserId, params.fromPeerKey) ?? myUserId;
  const forwardedFrom = message.forwardedFrom ?? { userId: originalSender, createdAt: message.createdAt };
  const clientMessageId = genId();
  const createdAt = Date.now();

  if (to.kind === 'group') {
    const { stored } = await sendGroupMessage({ myUserId, group: to.group, text: message.text, clientMessageId, createdAt, forwardedFrom });
    publishMessagePatch({ myUserId, peerKey: groupPeerKey(to.group.groupId), id: stored.id, message: stored });
    return stored;
  }

  const bootstrap = await ensureV2Session({ myUserId, peerUserId: to.peerUserId });
  const base: StoredMessage = { id: clientMessageId, clientMessageId, serverMessageId: null, direction: 'out', text: message.text, createdAt, seq: null, status: 'sending', deliveredAt: null, readAt: null, replyTo: null, forwardedFrom };
  let stored: StoredMessage;
  try {
    const r = await sendMessageV2({ toUserId: to.peerUserId, plaintext: message.text, clientMessageId, initPacket: bootstrap.initPacket ?? null, forwardedFrom });
    stored = { ...base, serverMessageId: r.serverMessageId, seq: r.seq, status: 'sent' };
  } catch (e) {
    stored = { ...base, status: 'failed' };
    await upsertStoredMessage({ myUserId, peerUserId: to.peerUserId, message: stored });
    publishMessagePatch({ myUserId, peerKey: to.peerUserId, id: stored.id, message: stored });
    throw e;
  }
  await upsertStoredMessage({ myUserId, peerUserId: to.peerUserId, message: stored });
  publishMessagePatch({ myUserId, peerKey: to.peerUserId, id: stored.id, message: stored });
  return stored;
}

/** Reactions grouped for display: one chip per emoji with its count and whether we are among them. */
export function summarizeReactions(reactions: Record<string, string> | null | undefined, myUserId: string): Array<{ emoji: string; count: number; mine: boolean }> {
  if (!reactions) return [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const [userId, emoji] of Object.entries(reactions)) {
    const cur = byEmoji.get(emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (userId === myUserId) cur.mine = true;
    byEmoji.set(emoji, cur);
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}

export { textContent };
