
import type { V2Encrypted } from '../crypto/messageV2';
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
  protoVersion?: 2;
  v2?: V2Encrypted | null;
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
  protoVersion?: 2;
  v2?: V2Encrypted | null;
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
};
