

// src/shared/socket/messaging.ts
import type { NewMessageDTO, SendMessageDTO } from './types';
import { ensureSocketConnected } from './socket';
import { useAuthStore } from '../../store/auth.store';
import type { ReplyReference } from '../chat/types';

import { loadSession } from '../storage/sessionStore';
import { encryptV2, decryptV2 } from '../crypto/messageV2';
import type { RatchetSessionV2 } from '../crypto/sessionTypes';
import type { X3DHInitPacket } from '../crypto/x3dh';
import { ensureV2SessionFromIncoming } from '../crypto/sessionBootstrap';
import { makeConversationId } from '../utils/conversation';

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
}): Promise<{ serverMessageId: string }> {
  const socket = await ensureSocketConnected();

  const myUserId = requireMyUserId();

  const session = await loadSession({
    myUserId,
    peerUserId: params.toUserId,
  });

  if (!session || session.protoVersion !== 2) {
    throw new Error('No v2 session for this peer');
  }

  const { encrypted } = await encryptV2({
    myUserId,
    peerUserId: params.toUserId,
    session: session as RatchetSessionV2,
    plaintext: params.plaintext,
  });

  const dto: SendMessageDTO = {
    toUserId: params.toUserId,
    clientMessageId: params.clientMessageId,
    createdAt: Date.now(),
    protoVersion: 2,
    v2: encrypted,
    initPacket: params.initPacket ?? null,
    replyTo: params.replyTo ?? null,
  };

  return new Promise((resolve, reject) => {
    socket.emit('message:send', dto, (ack: any) => {
      if (!ack?.ok) return reject(new Error(ack?.error || 'Send failed'));
      resolve({ serverMessageId: ack.serverMessageId });
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
  replyTo?: ReplyReference | null;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
}) => void, options?: {
  peerUserId?: string;
  onFailure?: (reason: string) => void;
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

      if (msg.protoVersion !== 2) {
        throw new Error(`Unsupported realtime protoVersion: ${String(msg.protoVersion)}`);
      }

      // v2
      if (!msg.v2) throw new Error('Missing v2 payload');

      let session = await loadSession({
        myUserId,
        peerUserId: msg.fromUserId,
      });

      if ((!session || session.protoVersion !== 2) && msg.initPacket) {
        await ensureV2SessionFromIncoming({
          myUserId,
          peerUserId: msg.fromUserId,
          initPacket: msg.initPacket,
        });

        session = await loadSession({
          myUserId,
          peerUserId: msg.fromUserId,
        });
      }

      if (!session || session.protoVersion !== 2) {
        throw new Error(
          msg.initPacket
            ? 'Failed to establish v2 session from incoming initPacket'
            : 'Missing v2 session and initPacket for incoming message'
        );
      }

      const { plaintext } = await decryptV2({
        myUserId,
        peerUserId: msg.fromUserId,
        session: session as RatchetSessionV2,
        encrypted: msg.v2,
      });
      
      onMessage({
        fromUserId: msg.fromUserId,
        text: plaintext,
        serverMessageId: msg.serverMessageId,
        clientMessageId: msg.clientMessageId,
        createdAt: msg.createdAt,
        replyTo: msg.replyTo ?? null,
        status: msg.status,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
      });

      // Send delivery confirmation asynchronously (non-blocking)
      setImmediate(() => {
        try {
          socket.emit('message:delivered', {
            conversationId: msg.conversationId,
            serverMessageId: msg.serverMessageId,
          }, (ack: any) => {
            if (!ack?.ok) {
              console.warn('[messaging] failed to deliver confirmation:', ack?.error);
            }
          });

          // Also send read notification immediately since chat is open
          const conversationId = makeConversationId(String(myUserId), msg.fromUserId);
          socket.emit('message:read', { conversationId }, (ack: any) => {
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
      options?.onFailure?.(e instanceof Error ? e.message : 'Unknown realtime decrypt failure');
    }
  };

  socket.on('message:new', handler);
  return () => socket.off('message:new', handler);
}
