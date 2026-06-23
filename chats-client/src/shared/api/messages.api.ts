

import { http } from './http';
import type { V2Encrypted } from '../crypto/messageV2';
import type { X3DHInitPacket } from '../crypto/x3dh';
import type { ReplyReference } from '../chat/types';

export type HistoryProtoVersion = 2;

export interface HistoryItem {
  serverMessageId: string;
  conversationId?: string;
  fromUserId: string;
  toUserId: string;

  protoVersion?: HistoryProtoVersion;

  // v2
  v2?: V2Encrypted | null;
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;

  clientMessageId: string;
  createdAt: number;
  
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
}

export const messagesApi = {
  getWithUser: (peerUserId: string, params?: { limit?: number; before?: number }) =>
    http.get<HistoryResponse>(`/messages/with/${peerUserId}`, { params }),
  markAsRead: (conversationId: string) =>
    http.post<{ ok: boolean; updatedCount: number }>(`/messages/mark-read/${conversationId}`),
};
