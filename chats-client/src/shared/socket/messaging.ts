

// src/shared/socket/messaging.ts
import type { NewMessageDTO, SendMessageDTO } from './types';
import { ensureSocketConnected } from './socket';
import { useAuthStore } from '../../store/auth.store';
import type { ReplyReference } from '../chat/types';

import { loadSession } from '../storage/sessionStore';
import { encryptAndPersist } from '../chat/ratchetAdapter';
import { receiveIncoming } from '../chat/incoming';
import { ProtocolError, protocolErrorCode, type ProtocolErrorCode, type RatchetSessionV2 } from '@velo/protocol';
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
    plaintext: params.plaintext,
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
}) => void, options?: {
  peerUserId?: string;
  onFailure?: (reason: string, code: ProtocolErrorCode | null) => void;
}): Promise<() => void> {
  const socket = await ensureSocketConnected();

  const handler = async (msg: NewMessageDTO) => {
    try {
      const myUserId = requireMyUserId();

      if (msg.fromUserId === myUserId) {
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
      
      onMessage({
        fromUserId: msg.fromUserId,
        text: plaintext,
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
      options?.onFailure?.(e instanceof Error ? e.message : 'Unknown realtime decrypt failure', protocolErrorCode(e));
    }
  };

  socket.on('message:new', handler);
  return () => socket.off('message:new', handler);
}
