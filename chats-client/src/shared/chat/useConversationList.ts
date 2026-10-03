import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { conversationsApi, type ConversationListItem } from '../api/conversations.api';
import { messagesApi } from '../api/messages.api';
import { userApi, type UserListItem } from '../api/user.api';
import { groupPeerKey, type GroupView } from '../api/groups.api';
import { ensureSocketConnected, getSocket } from '../socket/socket';
import { ingestLiveMessage } from '../notifications/pushIngest';
import { latestStoredMessagesByPeer, listStoredMessages, searchStoredMessages, type SearchHit, type StoredMessage } from '../storage/messageStore';
import { subscribeToMessagePatches } from './actions';
import { formatConversationPreview, previewSenderLabel } from './conversationPreview';
import { useProfilesStore } from '../../store/profiles.store';
import type { GroupListHandle } from './useGroupList';

/**
 * C1: the chat list's data: the conversations from the server, their
 * local previews (A1), the directory and message search results, and the
 * live socket updates that keep all of it current while the list is open.
 */
export function useConversationList({
  myUserId,
  isAuthenticated,
  activeChatPeerUserId,
  trimmedQuery,
  showingSearch,
  canSearch,
  recentlyClosedChatPeerUserId,
  onHandledClosedChat,
  groupList,
}: {
  myUserId: string | null;
  isAuthenticated: boolean;
  activeChatPeerUserId: string | null;
  trimmedQuery: string;
  showingSearch: boolean;
  canSearch: boolean;
  recentlyClosedChatPeerUserId: string | null;
  onHandledClosedChat: () => void;
  groupList: GroupListHandle;
}) {
  const { refreshGroupsSilently, applyLiveGroupMessage, applyGroupChanged } = groupList;
  const profiles = useProfilesStore((s) => s.byUser); // T7.7
  const [messageHits, setMessageHits] = useState<SearchHit[]>([]); // T7.8
  // A1: the newest stored record per conversation, read from the sealed store; the server never knows content.
  const [previews, setPreviews] = useState<Record<string, StoredMessage>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [searchItems, setSearchItems] = useState<UserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationsRef = useRef<ConversationListItem[]>([]);

  // T7.8: the local store is searched alongside contacts (debounced; sealed records are decrypted on the fly).
  useEffect(() => {
    if (!showingSearch || !canSearch || !myUserId) {
      setMessageHits([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const hits = await searchStoredMessages({ myUserId: String(myUserId), query: trimmedQuery, maxResults: 30 });
        if (!cancelled) setMessageHits(hits);
      } catch (e) {
        console.warn('[ChatListScreen] message search failed:', e);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [canSearch, myUserId, showingSearch, trimmedQuery]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const refreshPreviews = useCallback(async () => {
    if (!myUserId) return;
    try {
      setPreviews(await latestStoredMessagesByPeer(String(myUserId)));
    } catch (e: any) {
      console.warn('[ChatListScreen] preview refresh failed:', e?.message || e);
    }
  }, [myUserId]);

  // A1: a message sent, edited, deleted or expired anywhere in the app updates its row at once.
  useEffect(() => {
    if (!myUserId) return undefined;
    const me = String(myUserId);
    return subscribeToMessagePatches((patch) => {
      if (patch.myUserId !== me) return;
      listStoredMessages({ myUserId: me, peerUserId: patch.peerKey, limit: 1 })
        .then(([latest]) => {
          setPreviews((prev) => {
            const next = { ...prev };
            if (latest) next[patch.peerKey] = latest;
            else delete next[patch.peerKey];
            return next;
          });
        })
        .catch((e) => console.warn('[ChatListScreen] preview patch failed:', e?.message || e));
    });
  }, [myUserId]);

  const previewFor = useCallback(
    (item: ConversationListItem): string => {
      const m = previews[item.peerUserId];
      return m ? formatConversationPreview(m, { senderLabel: previewSenderLabel(m, { isGroup: false }) }) : '';
    },
    [previews],
  );

  const groupPreviewFor = useCallback(
    (group: GroupView): string => {
      const m = previews[groupPeerKey(group.groupId)];
      if (!m) return '';
      const memberName = m.senderUserId ? profiles[m.senderUserId]?.name?.trim() || group.members.find((member) => member.userId === m.senderUserId)?.username || null : null;
      return formatConversationPreview(m, { senderLabel: previewSenderLabel(m, { isGroup: true, memberName }) });
    },
    [previews, profiles],
  );

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await conversationsApi.list();
      setConversations(res.data.items);
      refreshGroupsSilently();
      refreshPreviews();
    } catch (e: any) {
      setError(e?.message || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [refreshGroupsSilently, refreshPreviews]);

  const refreshConversationsSilently = useCallback(async () => {
    try {
      refreshPreviews();
      const res = await conversationsApi.list();
      setConversations(res.data.items);
      setError(null);
    } catch (e: any) {
      console.warn('[ChatListScreen] Silent conversation refresh failed:', e?.message || e);
    }
  }, [refreshPreviews]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (showingSearch && trimmedQuery.length >= 2) {
        const res = await userApi.getUsers({ q: trimmedQuery, limit: 50 });
        setSearchItems(res.data.items);
      } else {
        const res = await conversationsApi.list();
        setConversations(res.data.items);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to refresh data');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadUsers(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await userApi.getUsers({ q: query || undefined, limit: 50 });
      setSearchItems(res.data.items);
    } catch (e: any) {
      setError(e?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  /** Clears the unread count locally at once, then tells the server and the sender. */
  const markConversationRead = useCallback(async (conversationId: string, peerUserId: string) => {
    setConversations((prev) =>
      prev.map((item) =>
        item.conversationId === conversationId ? { ...item, unreadCount: 0 } : item,
      ),
    );

    await Promise.allSettled([
      conversationsApi.markAsRead(peerUserId),
      messagesApi.markAsRead(conversationId),
    ]);

    try {
      await ensureSocketConnected();
      const socket = getSocket();
      socket.emit('message:read', { conversationId });
    } catch (e) {
      console.warn('[ChatListScreen] Failed to emit message:read:', (e as any)?.message || e);
    }
  }, []);

  useEffect(() => {
    if (!recentlyClosedChatPeerUserId) return;

    setConversations((prev) =>
      prev.map((conv) =>
        conv.peerUserId === recentlyClosedChatPeerUserId
          ? { ...conv, unreadCount: 0 }
          : conv
      )
    );

    refreshConversationsSilently();
    onHandledClosedChat();
  }, [onHandledClosedChat, recentlyClosedChatPeerUserId, refreshConversationsSilently]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  useEffect(() => {
    if (!isAuthenticated) return;

    let unsubscribed = false;
    let cleanup: (() => void) | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupListener = async () => {
      try {
        const socket = await ensureSocketConnected();
        if (unsubscribed) return;

        const handler = (evt: any) => {
          if (!evt?.fromUserId) return;
          if (evt.g1 && evt.groupId) {
            applyLiveGroupMessage(evt);
            return;
          }
          if (evt.fromUserId === myUserId) {
            refreshConversationsSilently();
            return;
          }

          const foundConversation = conversationsRef.current.some(
            (conv) =>
              conv.conversationId === evt.conversationId ||
              conv.peerUserId === evt.fromUserId
          );

          setConversations((prev) => {
            const next = prev.map((conv) => {
              if (
                conv.conversationId !== evt.conversationId &&
                conv.peerUserId !== evt.fromUserId
              ) {
                return conv;
              }

              return {
                ...conv,
                unreadCount:
                  typeof evt.unreadCount === 'number'
                    ? evt.unreadCount
                    : (conv.unreadCount ?? 0) + 1,
                lastMessageAt: evt.createdAt ?? Date.now(),
              };
            });

            if (!foundConversation) return prev;

            return next;
          });

          // T3.3: a message for a chat that is not open is decrypted, stored and acked
          // here (the open chat handles its own), then notified: sender name from local
          // data, text only if the user enabled previews (pushPolicy decides).
          const isCurrentChatOpen = activeChatPeerUserId === evt.fromUserId;
          if (!isCurrentChatOpen && myUserId && evt.protoVersion === 4 && evt.v4) {
            ingestLiveMessage({
              myUserId,
              item: {
                serverMessageId: String(evt.serverMessageId),
                conversationId: evt.conversationId,
                fromUserId: String(evt.fromUserId),
                toUserId: String(evt.toUserId ?? myUserId),
                protoVersion: 4,
                v4: evt.v4,
                initPacket: evt.initPacket ?? null,
                replyTo: evt.replyTo ?? null,
                clientMessageId: String(evt.clientMessageId ?? ''),
                createdAt: Number(evt.createdAt ?? Date.now()),
                seq: typeof evt.seq === 'number' ? evt.seq : null,
                status: evt.status,
                deliveredAt: evt.deliveredAt ?? null,
                readAt: evt.readAt ?? null,
              },
            }).catch((ingestError) => {
              console.warn('[ChatListScreen] Failed to ingest live message:', ingestError);
            });
          }

          refreshConversationsSilently();
        };

        socket.on('message:new', handler);
        socket.on('connect', refreshConversationsSilently);
        socket.on('user:deleted', refreshConversationsSilently); // T7.6: the pair's conversation is gone server-side
        socket.on('group:changed', applyGroupChanged);
        cleanup = () => {
          socket.off('message:new', handler);
          socket.off('connect', refreshConversationsSilently);
          socket.off('user:deleted', refreshConversationsSilently);
          socket.off('group:changed', applyGroupChanged);
        };
      } catch (e) {
        console.warn('[ChatListScreen] Socket not ready for message listener:', (e as any)?.message);
        if (!unsubscribed) {
          retryTimeout = setTimeout(() => {
            setupListener();
          }, 400);
        }
      }
    };

    setupListener();

    return () => {
      unsubscribed = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      cleanup?.();
    };
  }, [
    activeChatPeerUserId,
    isAuthenticated,
    myUserId,
    refreshConversationsSilently,
    applyLiveGroupMessage,
    applyGroupChanged,
  ]);

  useEffect(() => {
    if (!canSearch) return;

    const timer = setTimeout(() => {
      if (showingSearch) {
        loadUsers(trimmedQuery);
      } else {
        loadConversations();
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedQuery, showingSearch, canSearch, loadConversations]);

  return {
    conversations,
    loading,
    error,
    refreshing,
    searchItems,
    messageHits,
    previewFor,
    groupPreviewFor,
    loadConversations,
    refreshConversationsSilently,
    onRefresh,
    markConversationRead,
  };
}
