import { useEffect } from 'react';
import { conversationsApi } from '../api/conversations.api';
import { messagesApi } from '../api/messages.api';
import { getSocket } from '../socket/socket';

export const makeConversationId = (userA: string, userB: string) => [userA, userB].sort().join(':');

/** C1: opening a chat marks it read on the server and tells the sender over the socket. */
export function useMarkConversationRead({ myUserId, peerUserId }: { myUserId: string | null; peerUserId: string }): void {
  useEffect(() => {
    if (!myUserId) return;

    conversationsApi.markAsRead(peerUserId).catch((e) => {
      console.warn('[ChatScreen] Failed to mark conversation as read:', e?.message || e);
    });

    const currentConversationId = makeConversationId(myUserId, peerUserId);
    messagesApi.markAsRead(currentConversationId).catch((e) => {
      console.warn('[ChatScreen] Failed to mark messages as read:', e?.message || e);
    });

    try {
      const socket = getSocket();
      socket.emit('message:read', { conversationId: currentConversationId });
    } catch (e) {
      console.warn('[ChatScreen] Socket not available for message:read:', (e as any)?.message);
    }
  }, [myUserId, peerUserId]);
}
