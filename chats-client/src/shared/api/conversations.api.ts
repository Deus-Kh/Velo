import { http } from './http';
import { API_ENDPOINTS } from './endpoints';

export interface ConversationListItem {
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
  peerEmail: string;
  peerHasPublicKey: boolean;
  lastMessageAt: number;
  lastProtoVersion: number;
  lastMessagePreview: string;
  unreadCount: number;
}

export interface ConversationsResponse {
  items: ConversationListItem[];
}

export const conversationsApi = {
  list: () => http.get<ConversationsResponse>(API_ENDPOINTS.CONVERSATIONS.LIST),
  markAsRead: (peerUserId: string) =>
    http.post<{ ok: boolean }>(`${API_ENDPOINTS.BASE}/conversations/mark-read/${peerUserId}`),
};
