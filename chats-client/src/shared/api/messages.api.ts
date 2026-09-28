

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
  /** T3.2: server-assigned per-conversation order (null on pre-T3.2 items). */
  seq?: number | null;

  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
}

/** T3.1: delivery/read state of one of my own messages, for a sender that was offline. */
export interface ReceiptItem {
  serverMessageId: string;
  clientMessageId: string;
  createdAt: number;
  seq?: number | null;
  status: 'delivered' | 'read';
  deliveredAt?: number | null;
  readAt?: number | null;
}

export interface UndeliveredResponse {
  items: HistoryItem[];
  receipts: ReceiptItem[];
  serverTime: number;
}

export const messagesApi = {
  /** `before`: older page (descending on the server). `after`: newer than the latest stored (ascending), T2.14 sync. */
  getWithUser: (peerUserId: string, params?: { limit?: number; before?: number; after?: number }) =>
    http.get<HistoryResponse>(`/messages/with/${peerUserId}`, { params }),
  markAsRead: (conversationId: string) =>
    http.post<{ ok: boolean; updatedCount: number }>(`/messages/mark-read/${conversationId}`),

  /** T3.1: ciphertext the server still holds for me (oldest first) plus receipts for my own messages. `after` is a seq (T3.2). */
  getUndelivered: (params: { peerUserId?: string; limit?: number; after?: number; receiptsSince?: number }) =>
    http.get<UndeliveredResponse>('/messages/undelivered', { params }),

  /** T3.1: tell the server these messages are decrypted and stored here; it deletes their ciphertext. */
  ackDelivered: (serverMessageIds: string[]) =>
    http.post<{ ok: boolean; results: Record<string, string> }>('/messages/delivered', { serverMessageIds }),
};
