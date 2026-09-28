
import type { GroupMessage, MessageEnvelope } from '@velo/protocol';
import type { X3DHInitPacket } from '../crypto/x3dh';
import type { ReplyReference } from '../chat/types';

export interface V2Header {
  n: number;
  pn: number;
}



export type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  /** T3.2: server-assigned per-conversation order. Ordering uses it; createdAt is display only. */
  seq?: number | null;
  protoVersion?: 4;
  v4?: MessageEnvelope | null; // T3.6: encrypted header, opaque to the server
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;
};

export type NewMessageDTO = {
  serverMessageId: string;
  conversationId?: string;
  fromUserId: string;
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  /** T3.2: server-assigned per-conversation order. Ordering uses it; createdAt is display only. */
  seq?: number | null;
  protoVersion?: 4;
  v4?: MessageEnvelope | null; // T3.6: encrypted header, opaque to the server
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
  /** T6.3: a group message (one copy per recipient); `g1` instead of `v4`. */
  groupId?: string | null;
  g1?: GroupMessage | null;
  epoch?: number | null;
};
