

// src/shared/socket/messaging.ts
import type { NewMessageDTO, SendMessageDTO } from './types';
import { ensureSocketConnected } from './socket';
import { useAuthStore } from '../../store/auth.store';
import type { ReplyReference } from '../chat/types';

import { loadSession } from '../storage/sessionStore';
import { encryptAndPersist } from '../chat/ratchetAdapter';
import { receiveIncoming } from '../chat/incoming';
import { handleInboundAction } from '../chat/actions';
import { isBlockedLocally } from '../../store/blocks.store';
import { ensureV2Session } from '../crypto/sessionBootstrap';
import { reportDecryptFailure } from '../api/telemetry.api';
import { ProtocolError, protocolErrorCode, type ProtocolErrorCode, type RatchetSessionV2, encodeContent, decodeContent, isControlContent, textContent, type Content } from '@velo/protocol';
import type { X3DHInitPacket } from '../crypto/x3dh';

function requireMyUserId(): string {
  const myUserId = useAuthStore.getState().userId;
  if (!myUserId) throw new Error('Not authenticated: missing userId');
  return myUserId;
}

/**
 * v2 send (ratchet)
 * IMPORTANT: myUserId is always taken from store to avoid multi-account mismatch.
 */
export async function sendMessageV2(params: {
  toUserId: string;
  plaintext: string;
  clientMessageId: string;
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;
  /** T7.2: provenance of a forwarded message. */
  forwardedFrom?: { userId: string; createdAt: number } | null;
}): Promise<{ serverMessageId: string; seq: number | null }> {
  const socket = await ensureSocketConnected();

  const myUserId = requireMyUserId();

  const session = await loadSession({
    myUserId,
    peerUserId: params.toUserId,
  });

  if (!session || session.protoVersion !== 4) {
    throw new ProtocolError('NO_SESSION', 'No v2 session for this peer');
  }

  const { encrypted } = await encryptAndPersist({
    myUserId,
    peerUserId: params.toUserId,
    session: session as RatchetSessionV2,
    plaintext: encodeContent(textContent(params.plaintext, params.forwardedFrom ?? undefined)), // T6.2: content envelope
  });

  const dto: SendMessageDTO = {
    toUserId: params.toUserId,
    clientMessageId: params.clientMessageId,
    createdAt: Date.now(),
    protoVersion: 4,
    v4: encrypted,
    initPacket: params.initPacket ?? null,
    replyTo: params.replyTo ?? null,
  };

  return new Promise((resolve, reject) => {
    socket.emit('message:send', dto, (ack: any) => {
      if (!ack?.ok) return reject(new ProtocolError('SEND_FAILED', ack?.error || 'Send failed'));
      resolve({ serverMessageId: ack.serverMessageId, seq: typeof ack.seq === 'number' ? ack.seq : null });
    });
  });
}

/**
 * T6.2/T6.4: send control content (a sender-key distribution or request) to a
 * peer over the pairwise session, creating the session first if needed.
 */
export async function sendContent(peerUserId: string, content: Content): Promise<{ serverMessageId: string }> {
  const myUserId = requireMyUserId();
  const bootstrap = await ensureV2Session({ myUserId, peerUserId });
  const socket = await ensureSocketConnected();
  const session = await loadSession({ myUserId, peerUserId });
  if (!session || session.protoVersion !== 4) throw new ProtocolError('NO_SESSION', 'No v2 session for this peer');
  const { encrypted } = await encryptAndPersist({ myUserId, peerUserId, session: session as RatchetSessionV2, plaintext: encodeContent(content) });
  const dto: SendMessageDTO = {
    toUserId: peerUserId,
    clientMessageId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    protoVersion: 4,
    v4: encrypted,
    initPacket: bootstrap.initPacket ?? null,
    replyTo: null,
  };
  return new Promise((resolve, reject) => {
    socket.emit('message:send', dto, (ack: any) => {
      if (!ack?.ok) return reject(new ProtocolError('SEND_FAILED', ack?.error || 'Send failed'));
      resolve({ serverMessageId: ack.serverMessageId });
    });
  });
}

/** T6.4: control content is fanned out to every subscriber (group chats, the chat list) besides the chat's own handler. */
type ControlListener = (content: Content, meta: { fromUserId: string; serverMessageId: string }) => void | Promise<void>;
const controlListeners = new Set<ControlListener>();
export function subscribeToControlContent(listener: ControlListener): () => void {
  controlListeners.add(listener);
  return () => {
    controlListeners.delete(listener);
  };
}
export function publishControlContent(content: Content, meta: { fromUserId: string; serverMessageId: string }): void {
  for (const l of controlListeners) {
    Promise.resolve(l(content, meta)).catch((e) => console.warn('[messaging] control listener failed:', e));
  }
}

/**
 * Subscribes to incoming messages.
 * - v2 only: decrypt via ratchet session
 *
 * Note: This subscription is for inbound messages (server emits to receiver room).
 */
export async function subscribeToMessages(onMessage: (m: {
  fromUserId: string;
  text: string;
  serverMessageId: string;
  clientMessageId: string;
  createdAt: number;
  seq: number | null;
  replyTo?: ReplyReference | null;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
  forwardedFrom?: { userId: string; createdAt: number } | null;
}) => void, options?: {
  peerUserId?: string;
  onFailure?: (reason: string, code: ProtocolErrorCode | null) => void;
  /** T6.2: control content (sender-key distributions and requests) decrypted on this session. */
  onControl?: (content: Content, meta: { fromUserId: string; serverMessageId: string }) => void;
}): Promise<() => void> {
  const socket = await ensureSocketConnected();

  const handler = async (msg: NewMessageDTO) => {
    try {
      const myUserId = requireMyUserId();

      if (msg.fromUserId === myUserId) {
        return;
      }
      // T6.3: group copies are handled by the group paths (useGroupChat, the chat list), never here.
      if (msg.g1 || msg.groupId) {
        return;
      }
      if (isBlockedLocally(myUserId, msg.fromUserId)) {
        // T7.5: a blocked sender's copy (pre-block, or a server that missed the block) is dropped and deleted.
        socket.emit('message:delivered', { serverMessageId: msg.serverMessageId }, () => {});
        return;
      }

      if (options?.peerUserId && msg.fromUserId !== options.peerUserId) {
        return;
      }

      if (msg.protoVersion !== 4) {
        throw new Error(`Unsupported realtime protoVersion: ${String(msg.protoVersion)}`);
      }

      if (!msg.v4) throw new Error('Missing v4 payload');

      // T2.11: bootstrap (if needed) and decrypt; nothing is persisted unless the message decrypts.
      const { plaintext } = await receiveIncoming({
        myUserId,
        peerUserId: msg.fromUserId,
        initPacket: msg.initPacket ?? null,
        encrypted: msg.v4,
      });
      
      // T6.2: the plaintext is a content envelope; control messages take their own path and are still acked.
      const content = decodeContent(plaintext);
      if (content.kind !== 'text' && !isControlContent(content)) {
        // T7.2: a reaction, edit, delete request or timer: applied to the local store, then acked.
        handleInboundAction({ myUserId, peerKey: msg.fromUserId, actorUserId: msg.fromUserId, content }).finally(() => {
          socket.emit('message:delivered', { serverMessageId: msg.serverMessageId }, () => {});
        });
        return;
      }
      if (isControlContent(content)) {
        options?.onControl?.(content, { fromUserId: msg.fromUserId, serverMessageId: msg.serverMessageId });
        publishControlContent(content, { fromUserId: msg.fromUserId, serverMessageId: msg.serverMessageId });
        socket.emit('message:delivered', { serverMessageId: msg.serverMessageId }, () => {});
        return;
      }

      onMessage({
        fromUserId: msg.fromUserId,
        text: content.text,
        forwardedFrom: content.forwardedFrom ?? null,
        serverMessageId: msg.serverMessageId,
        clientMessageId: msg.clientMessageId,
        createdAt: msg.createdAt,
        seq: typeof msg.seq === 'number' ? msg.seq : null,
        replyTo: msg.replyTo ?? null,
        status: msg.status,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
      });

      // Send delivery confirmation asynchronously (non-blocking)
      setImmediate(() => {
        try {
          // The server derives the conversation from the stored message (T1.7).
          socket.emit('message:delivered', { serverMessageId: msg.serverMessageId }, (ack: any) => {
            if (!ack?.ok) {
              console.warn('[messaging] failed to deliver confirmation:', ack?.error);
            }
          });

          // Also send read notification immediately since chat is open.
          // Name the peer; the server derives the conversationId itself.
          socket.emit('message:read', { peerUserId: msg.fromUserId }, (ack: any) => {
            if (!ack?.ok) {
              console.warn('[messaging] failed to send read notification:', ack?.error);
            }
          });
        } catch (e) {
          console.warn('[messaging] failed to send delivery/read confirmation:', e);
        }
      });
    } catch (e) {
      console.warn('Decrypt failed:', e);
      reportDecryptFailure(protocolErrorCode(e)); // T4.6: the code only
      options?.onFailure?.(e instanceof Error ? e.message : 'Unknown realtime decrypt failure', protocolErrorCode(e));
    }
  };

  socket.on('message:new', handler);
  return () => socket.off('message:new', handler);
}
