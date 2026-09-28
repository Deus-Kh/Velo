

import { http } from './http';
import type { MessageEnvelope } from '@velo/protocol';
import type { X3DHInitPacket } from '../crypto/x3dh';
import type { ReplyReference } from '../chat/types';

export type HistoryProtoVersion = 3;

export interface HistoryItem {
  serverMessageId: string;
  conversationId?: string;
  fromUserId: string;
  toUserId: string;

  protoVersion?: HistoryProtoVersion;

  // v3 envelope (T2.5)
  v3?: MessageEnvelope | null;
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
  /** `before`: older page (descending on the server). `after`: newer than the latest stored (ascending), T2.14 sync. */
  getWithUser: (peerUserId: string, params?: { limit?: number; before?: number; after?: number }) =>
    http.get<HistoryResponse>(`/messages/with/${peerUserId}`, { params }),
  markAsRead: (conversationId: string) =>
    http.post<{ ok: boolean; updatedCount: number }>(`/messages/mark-read/${conversationId}`),
};
