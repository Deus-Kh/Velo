import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetPanel from '../components/BottomSheetPanel';
import ScreenHeader from '../components/ScreenHeader';
import SectionEyebrow from '../components/SectionEyebrow';
import StatusChip from '../components/StatusChip';
import { conversationsApi, type ConversationListItem } from '../shared/api/conversations.api';
import { messagesApi } from '../shared/api/messages.api';
import { userApi, type UserListItem } from '../shared/api/user.api';
import { useAuthStore } from '../store/auth.store';
import { ensureSocketConnected, getSocket } from '../shared/socket/socket';
import { useAppearanceStore } from '../store/appearance.store';
import { useChatListStore } from '../store/chat-list.store';
import { useNotificationPreferencesStore } from '../store/notification-preferences.store';
import { getNotificationPreferencesForUser } from '../store/notification-preferences.store';
import { useAppUiStore } from '../store/app-ui.store';
import { displayIncomingMessageNotification } from '../shared/notifications/notifee';

type ChatOpenHandler = (chat: { peerUserId: string; peerUsername?: string }) => void;

type SelectedConversationAction = {
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
  peerEmail: string;
  unreadCount: number;
};

type SearchResultListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'conversation'; id: string; item: ConversationListItem }
  | { type: 'user'; id: string; item: UserListItem };

type HomeListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'conversation'; id: string; item: ConversationListItem };

function formatConversationTime(value: number) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function getConversationPreview(item: ConversationListItem) {
  const preview = item.lastMessagePreview?.trim();
  if (preview) return preview;
  return 'Encrypted conversation ready';
}

function sortConversations(
  items: ConversationListItem[],
  pinnedConversationIds: string[],
) {
  const pinnedSet = new Set(pinnedConversationIds);

  return [...items].sort((a, b) => {
    const aPinned = pinnedSet.has(a.conversationId) ? 1 : 0;
    const bPinned = pinnedSet.has(b.conversationId) ? 1 : 0;

    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }

    return b.lastMessageAt - a.lastMessageAt;
  });
}

function SecurityBadge({
  ready,
  label,
}: {
  ready: boolean;
  label: string;
}) {
  return (
    <StatusChip label={label} tone={ready ? 'primary' : 'warning'} />
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-elevated border border-border">
        <View className="h-6 w-6 rounded-full bg-primary/30" />
      </View>
      <Text className="mt-5 text-center text-xl font-semibold text-text">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-6 text-muted">{description}</Text>
    </View>
  );
}

function ChatListSkeleton({
  compact,
}: {
  compact: boolean;
}) {
  const items = compact ? [0, 1, 2, 3] : [0, 1, 2];

  return (
    <View className="mt-4 px-4">
      {items.map((item) => (
        <View
          key={item}
          className={`mb-3 rounded-[22px] border border-border bg-surface-elevated ${
            compact ? 'p-3.5' : 'p-4'
          }`}
        >
          <View className="flex-row items-start">
            <View className={`mr-4 rounded-full bg-background-alt/80 ${compact ? 'h-12 w-12' : 'h-14 w-14'}`} />

            <View className="flex-1">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <View className="h-4 w-28 rounded-full bg-background-alt/80" />
                  <View className="mt-2 h-3.5 w-36 rounded-full bg-background-alt/65" />
                </View>
                <View className="h-3.5 w-12 rounded-full bg-background-alt/65" />
              </View>

              <View className={`h-3.5 rounded-full bg-background-alt/60 ${compact ? 'mt-3 w-[72%]' : 'mt-4 w-[76%]'}`} />

              <View className={`flex-row items-center justify-between ${compact ? 'mt-3' : 'mt-4'}`}>
                <View className="h-7 w-32 rounded-full bg-background-alt/75" />
                <View className="h-3.5 w-24 rounded-full bg-background-alt/60" />
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function InlineSearchLoading() {
  return (
    <View className="mx-4 mt-4 flex-row items-center rounded-[18px] border border-border bg-surface-elevated px-4 py-3">
      <ActivityIndicator size="small" color="#2DD4BF" />
      <Text className="ml-3 text-sm text-muted">Searching encrypted contacts...</Text>
    </View>
  );
}

const ARCHIVE_REVEAL_DRAG_TRIGGER = 28;
const ARCHIVE_REVEAL_HIT_ZONE_HEIGHT = 28;
const ARCHIVE_REVEAL_HORIZONTAL_TOLERANCE = 10;

function ArchivedRow({
  count,
  unreadCount,
  compact,
  onPress,
}: {
  count: number;
  unreadCount: number;
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mx-4 mt-4 flex-row items-center rounded-[18px] border border-border bg-surface-elevated active:opacity-80 ${
        compact ? 'px-3 py-2.5' : 'px-3.5 py-3'
      }`}
    >
      <View className={`mr-3 items-center justify-center rounded-full border border-border bg-background-alt/70 ${compact ? 'h-9 w-9' : 'h-10 w-10'}`}>
        <Text className="text-[16px] text-muted">⌄</Text>
      </View>

      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-text">Archived</Text>
        <Text className="mt-0.5 text-[12px] text-muted">
          {count} chat{count === 1 ? '' : 's'} stored outside the main list
        </Text>
      </View>

      <View className="items-end">
        {unreadCount > 0 ? (
          <View className="min-w-6 rounded-full bg-primary px-2 py-[5px]">
            <Text className="text-center text-xs font-semibold text-background">
              {unreadCount}
            </Text>
          </View>
        ) : (
          <Text className="text-[12px] font-medium text-muted">Open</Text>
        )}
      </View>
    </Pressable>
  );
}

export default function ChatListScreen({
  onOpenChat,
  recentlyClosedChatPeerUserId,
  onHandledClosedChat,
}: {
  onOpenChat: ChatOpenHandler;
  recentlyClosedChatPeerUserId: string | null;
  onHandledClosedChat: () => void;
}) {
  const insets = useSafeAreaInsets();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const myUserId = useAuthStore((s) => s.userId);
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const pinnedConversationIds = useChatListStore((s) => s.pinnedConversationIds);
  const archivedConversationIds = useChatListStore((s) => s.archivedConversationIds);
  const togglePinnedConversation = useChatListStore((s) => s.togglePinnedConversation);
  const toggleArchivedConversation = useChatListStore((s) => s.toggleArchivedConversation);
  const notificationPreferencesByUserId = useNotificationPreferencesStore(
    (s) => s.preferencesByUserId,
  );
  const activeChatPeerUserId = useAppUiStore((s) => s.activeChatPeerUserId);

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [searchItems, setSearchItems] = useState<UserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationAction, setSelectedConversationAction] =
    useState<SelectedConversationAction | null>(null);
  const [showArchivedView, setShowArchivedView] = useState(false);
  const conversationsRef = useRef<ConversationListItem[]>([]);
  const homeListOffsetRef = useRef(0);
  const archiveRevealTriggeredRef = useRef(false);
  const [archivePeekVisible, setArchivePeekVisible] = useState(false);

  const trimmedQuery = useMemo(() => q.trim(), [q]);
  const showingSearch = trimmedQuery.length > 0;
  const canSearch = useMemo(
    () => trimmedQuery.length === 0 || trimmedQuery.length >= 2,
    [trimmedQuery]
  );

  const headerSubtitle = showingSearch
    ? 'Find a contact and open an encrypted conversation.'
    : showArchivedView
      ? 'Archived conversations stay out of the main list until you bring them back.'
      : 'Private conversations, secured end to end.';
  const listContentContainerStyle = useMemo(
    () => ({
      paddingHorizontal: interfaceDensity === 'compact' ? 16 : 20,
      paddingBottom: interfaceDensity === 'compact' ? 18 : 24,
    }),
    [interfaceDensity],
  );
  const sortedConversations = useMemo(
    () => sortConversations(conversations, pinnedConversationIds),
    [conversations, pinnedConversationIds],
  );
  const activeConversations = useMemo(
    () =>
      sortedConversations.filter(
        (item) => !archivedConversationIds.includes(item.conversationId),
      ),
    [archivedConversationIds, sortedConversations],
  );
  const archivedConversations = useMemo(
    () =>
      sortedConversations.filter((item) =>
        archivedConversationIds.includes(item.conversationId),
      ),
    [archivedConversationIds, sortedConversations],
  );
  const homeListItems = useMemo(() => {
    const items: HomeListItem[] = [];
    const pinnedSet = new Set(pinnedConversationIds);
    const pinned = activeConversations.filter((item) => pinnedSet.has(item.conversationId));
    const regular = activeConversations.filter((item) => !pinnedSet.has(item.conversationId));

    if (pinned.length > 0) {
      items.push({ type: 'section', id: 'section-pinned', label: 'Pinned' });
      pinned.forEach((item) => {
        items.push({ type: 'conversation', id: `conversation-${item.conversationId}`, item });
      });
    }

    if (regular.length > 0) {
      items.push({
        type: 'section',
        id: pinned.length > 0 ? 'section-all-chats' : 'section-chats',
        label: pinned.length > 0 ? 'All Chats' : 'Chats',
      });
      regular.forEach((item) => {
        items.push({ type: 'conversation', id: `conversation-${item.conversationId}`, item });
      });
    }

    return items;
  }, [activeConversations, pinnedConversationIds]);
  const matchingConversations = useMemo(() => {
    if (!showingSearch) return [];

    const query = trimmedQuery.toLowerCase();
    return sortedConversations.filter((item) => {
      const username = item.peerUsername?.toLowerCase() ?? '';
      const email = item.peerEmail?.toLowerCase() ?? '';
      return username.includes(query) || email.includes(query);
    });
  }, [showingSearch, sortedConversations, trimmedQuery]);
  const matchingSearchContacts = useMemo(() => {
    const existingPeerIds = new Set(sortedConversations.map((item) => item.peerUserId));
    return searchItems.filter((item) => !existingPeerIds.has(item.userId));
  }, [searchItems, sortedConversations]);
  const searchResultItems = useMemo(() => {
    const items: SearchResultListItem[] = [];

    if (matchingConversations.length > 0) {
      items.push({
        type: 'section',
        id: 'section-existing-chats',
        label: 'Existing Chats',
      });

      matchingConversations.forEach((item) => {
        items.push({
          type: 'conversation',
          id: `conversation-${item.conversationId}`,
          item,
        });
      });
    }

    if (matchingSearchContacts.length > 0) {
      items.push({
        type: 'section',
        id: 'section-new-contacts',
        label: matchingConversations.length > 0 ? 'New Contacts' : 'Contacts',
      });

      matchingSearchContacts.forEach((item) => {
        items.push({
          type: 'user',
          id: `user-${item.userId}`,
          item,
        });
      });
    }

    return items;
  }, [matchingConversations, matchingSearchContacts]);
  const showInitialConversationSkeleton = loading && !showingSearch && conversations.length === 0;
  const showInlineSearchLoading = loading && showingSearch;
  const shouldAllowArchiveReveal =
    !showingSearch && !showArchivedView && archivedConversations.length > 0;

  const archiveRevealGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(shouldAllowArchiveReveal)
    .activeOffsetY(8)
    .failOffsetX([
      -ARCHIVE_REVEAL_HORIZONTAL_TOLERANCE,
      ARCHIVE_REVEAL_HORIZONTAL_TOLERANCE,
    ])
    .onBegin(() => {
      archiveRevealTriggeredRef.current = false;
    })
    .onUpdate((event) => {
      if (
        homeListOffsetRef.current <= 0 &&
        event.translationY > ARCHIVE_REVEAL_DRAG_TRIGGER &&
        !archiveRevealTriggeredRef.current
      ) {
        archiveRevealTriggeredRef.current = true;
        setArchivePeekVisible(true);
      }
    })
    .onEnd(() => {
      archiveRevealTriggeredRef.current = false;
    })
    .onFinalize(() => {
      archiveRevealTriggeredRef.current = false;
    });
  const archivedUnreadCount = useMemo(
    () => archivedConversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0),
    [archivedConversations],
  );

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (!shouldAllowArchiveReveal) {
      setArchivePeekVisible(false);
    }
  }, [shouldAllowArchiveReveal]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await conversationsApi.list();
      setConversations(res.data.items);
    } catch (e: any) {
      setError(e?.message || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshConversationsSilently = useCallback(async () => {
    try {
      const res = await conversationsApi.list();
      setConversations(res.data.items);
      setError(null);
    } catch (e: any) {
      console.warn('[ChatListScreen] Silent conversation refresh failed:', e?.message || e);
    }
  }, []);

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

  const handleOpenConversationActions = useCallback((item: ConversationListItem) => {
    setSelectedConversationAction({
      conversationId: item.conversationId,
      peerUserId: item.peerUserId,
      peerUsername: item.peerUsername,
      peerEmail: item.peerEmail,
      unreadCount: item.unreadCount,
    });
  }, []);

  const handleCloseConversationActions = useCallback(() => {
    setSelectedConversationAction(null);
  }, []);

  const handleMarkConversationAsRead = useCallback(async () => {
    if (!selectedConversationAction) return;

    const { conversationId, peerUserId } = selectedConversationAction;

    setConversations((prev) =>
      prev.map((item) =>
        item.conversationId === conversationId ? { ...item, unreadCount: 0 } : item,
      ),
    );
    setSelectedConversationAction(null);

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
  }, [selectedConversationAction]);

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

          const preferences = getNotificationPreferencesForUser(
            notificationPreferencesByUserId,
            useAuthStore.getState().userId,
          );
          const isAppActive = AppState.currentState === 'active';
          const isCurrentChatOpen = activeChatPeerUserId === evt.fromUserId;

          if (isAppActive && !isCurrentChatOpen && preferences.inAppAlertsEnabled) {
            const matchingConversation = conversationsRef.current.find(
              (conv) =>
                conv.conversationId === evt.conversationId || conv.peerUserId === evt.fromUserId,
            );

            displayIncomingMessageNotification({
              title: matchingConversation?.peerUsername || 'New message',
              body: preferences.showMessagePreview
                ? 'New encrypted message'
                : 'You received a new message',
              conversationId: evt.conversationId,
              fromUserId: evt.fromUserId,
              soundEnabled: preferences.soundEnabled,
              vibrationEnabled: preferences.vibrationEnabled,
            }).catch((notificationError) => {
              console.warn('[ChatListScreen] Failed to display local notification:', notificationError);
            });
          }

          refreshConversationsSilently();
        };

        socket.on('message:new', handler);
        socket.on('connect', refreshConversationsSilently);
        cleanup = () => {
          socket.off('message:new', handler);
          socket.off('connect', refreshConversationsSilently);
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
    notificationPreferencesByUserId,
    refreshConversationsSilently,
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

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={showArchivedView ? 'Archived' : 'Chats'}
        subtitle={headerSubtitle}
        actions={
          showArchivedView ? (
            <Pressable
              onPress={() => setShowArchivedView(false)}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-elevated active:opacity-80"
            >
              <Text className="text-2xl leading-none text-text">{'\u2039'}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => logout()}
              className={`rounded-full border border-border px-4 ${interfaceDensity === 'compact' ? 'py-1.5' : 'py-2'} active:opacity-80 ${
                surfaceStyle === 'glass' ? 'bg-surface/80' : 'bg-surface-elevated'
              }`}
            >
              <Text className="text-sm font-semibold text-text">Log out</Text>
            </Pressable>
          )
        }
      />
      <View className="px-4">
        <View
          className={`mt-3 rounded-[20px] border border-border bg-surface-elevated px-4 ${
            interfaceDensity === 'compact' ? 'py-0.5' : 'py-1'
          }`}
        >
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search contacts"
            placeholderTextColor="#94A3B8"
            selectionColor="#2DD4BF"
            cursorColor="#2DD4BF"
            underlineColorAndroid="transparent"
            className="py-3 text-[15px] text-text"
          />
        </View>
      </View>

      {showInitialConversationSkeleton ? (
        <ChatListSkeleton compact={interfaceDensity === 'compact'} />
      ) : null}

      {showInlineSearchLoading ? <InlineSearchLoading /> : null}

      {loading && !showingSearch && conversations.length > 0 && (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Loading conversations...</Text>
        </View>
      )}

      {!showInitialConversationSkeleton && !showInlineSearchLoading && !loading && error && (
        <View className="mx-5 mt-5 rounded-[24px] border border-danger/40 bg-danger/10 p-5">
          <Text className="text-base font-semibold text-danger">Unable to load chats</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{error}</Text>
          <Pressable
            onPress={onRefresh}
            className="mt-4 self-start rounded-full bg-surface-elevated px-4 py-2 active:opacity-80"
          >
            <Text className="font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && !showingSearch && !showArchivedView && activeConversations.length === 0 && archivedConversations.length === 0 && (
        <EmptyState
          title="No conversations yet"
          description="Search for a contact above to create your first secure conversation."
        />
      )}

      {!loading && !error && !showingSearch && showArchivedView && archivedConversations.length === 0 && (
        <EmptyState
          title="No archived chats"
          description="Archived conversations will appear here when you move them out of the main list."
        />
      )}

      {!loading &&
        !error &&
        showingSearch &&
        canSearch &&
        searchResultItems.length === 0 && (
        <EmptyState
          title="No results found"
          description="Try a different username or email to find an existing chat or start a new encrypted one."
        />
      )}

      {!loading && !error && showingSearch && !canSearch && (
        <EmptyState
          title="Keep typing"
          description="Search becomes available after at least two characters."
        />
      )}

      {!loading && !error && !showingSearch && !showArchivedView && archivePeekVisible && archivedConversations.length > 0 ? (
        <ArchivedRow
          count={archivedConversations.length}
          unreadCount={archivedUnreadCount}
          compact={interfaceDensity === 'compact'}
          onPress={() => setShowArchivedView(true)}
        />
      ) : null}

      {!loading && !error && !showingSearch && !showArchivedView && homeListItems.length > 0 && (
        <View className="relative flex-1">
          <GestureDetector gesture={archiveRevealGesture}>
            <View
              className="absolute left-0 right-0 top-0 z-10"
              style={{ height: ARCHIVE_REVEAL_HIT_ZONE_HEIGHT }}
            />
          </GestureDetector>

          <FlatList
            data={homeListItems}
            keyExtractor={(item) => item.id}
            className="mt-4"
            contentContainerStyle={listContentContainerStyle}
            onScroll={(event) => {
              const offsetY = event.nativeEvent.contentOffset.y;
              homeListOffsetRef.current = offsetY;

              if (offsetY > 18 && archivePeekVisible) {
                setArchivePeekVisible(false);
              }
            }}
            scrollEventThrottle={16}
            renderItem={({ item }) =>
              item.type === 'section' ? (
                <SectionEyebrow title={item.label} compact />
              ) : (
                <Pressable
                  onPress={() =>
                    onOpenChat({
                      peerUserId: item.item.peerUserId,
                      peerUsername: item.item.peerUsername,
                    })
                  }
                  onLongPress={() => handleOpenConversationActions(item.item)}
                  className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
                    surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
                  } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
                >
                  <View className="flex-row items-start">
                    <View className={`mr-4 items-center justify-center rounded-full bg-primary-soft ${
                      interfaceDensity === 'compact' ? 'h-12 w-12' : 'h-14 w-14'
                    }`}>
                      <Text className="text-lg font-semibold text-primary">
                        {(item.item.peerUsername || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className="text-base font-semibold text-text">
                              {item.item.peerUsername}
                            </Text>
                            {pinnedConversationIds.includes(item.item.conversationId) ? (
                              <View className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5">
                                <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-primary">
                                  Pinned
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text className="mt-1 text-sm text-muted">{item.item.peerEmail}</Text>
                        </View>

                        <View className="items-end">
                          <Text className="text-xs font-medium text-muted">
                            {formatConversationTime(item.item.lastMessageAt)}
                          </Text>
                          {item.item.unreadCount > 0 ? (
                            <View className="mt-2 min-w-6 rounded-full bg-primary px-2 py-1">
                              <Text className="text-center text-xs font-semibold text-background">
                                {item.item.unreadCount}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <Text
                        className={`text-sm leading-6 text-muted ${
                          interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                        }`}
                      >
                        {getConversationPreview(item.item)}
                      </Text>

                      <View
                        className={`flex-row items-center justify-between ${
                          interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                        }`}
                      >
                        <SecurityBadge
                          ready={Boolean(item.item.peerHasPublicKey)}
                          label={item.item.peerHasPublicKey ? 'Secure channel ready' : 'Public key missing'}
                        />
                        <Text className="text-xs font-medium text-muted">Open conversation</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              )
            }
          />
        </View>
      )}

      {!loading && !error && !showingSearch && showArchivedView && archivedConversations.length > 0 && (
        <FlatList
          data={archivedConversations}
          keyExtractor={(item) => item.conversationId}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#94A3B8"
            />
          }
          className="mt-4"
          contentContainerStyle={listContentContainerStyle}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                onOpenChat({
                  peerUserId: item.peerUserId,
                  peerUsername: item.peerUsername,
                })
              }
              onLongPress={() => handleOpenConversationActions(item)}
              className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
                surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
              } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
            >
              <View className="flex-row items-start">
                <View className={`mr-4 items-center justify-center rounded-full bg-primary-soft ${
                  interfaceDensity === 'compact' ? 'h-12 w-12' : 'h-14 w-14'
                }`}>
                  <Text className="text-lg font-semibold text-primary">
                    {(item.peerUsername || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>

                <View className="flex-1">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-base font-semibold text-text">
                          {item.peerUsername}
                        </Text>
                        <View className="rounded-full border border-border bg-background-alt/55 px-2 py-0.5">
                          <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-muted">
                            Archived
                          </Text>
                        </View>
                      </View>
                      <Text className="mt-1 text-sm text-muted">{item.peerEmail}</Text>
                    </View>

                    <View className="items-end">
                      <Text className="text-xs font-medium text-muted">
                        {formatConversationTime(item.lastMessageAt)}
                      </Text>
                      {item.unreadCount > 0 ? (
                        <View className="mt-2 min-w-6 rounded-full bg-primary px-2 py-1">
                          <Text className="text-center text-xs font-semibold text-background">
                            {item.unreadCount}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <Text
                    className={`text-sm leading-6 text-muted ${
                      interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                    }`}
                  >
                    {getConversationPreview(item)}
                  </Text>

                  <View
                    className={`flex-row items-center justify-between ${
                      interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                    }`}
                  >
                    <SecurityBadge
                      ready={Boolean(item.peerHasPublicKey)}
                      label={item.peerHasPublicKey ? 'Secure channel ready' : 'Public key missing'}
                    />
                    <Text className="text-xs font-medium text-muted">Open conversation</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      {!loading && !error && showingSearch && canSearch && (
        <FlatList
          data={searchResultItems}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#94A3B8"
            />
          }
          className="mt-4"
          contentContainerStyle={listContentContainerStyle}
          renderItem={({ item }) => (
            item.type === 'section' ? (
              <SectionEyebrow title={item.label} compact />
            ) : item.type === 'conversation' ? (
              <Pressable
                onPress={() =>
                  onOpenChat({
                    peerUserId: item.item.peerUserId,
                    peerUsername: item.item.peerUsername,
                  })
                }
                onLongPress={() => handleOpenConversationActions(item.item)}
                className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
                  surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
                } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
              >
                <View className="flex-row items-start">
                  <View className={`mr-4 items-center justify-center rounded-full bg-primary-soft ${
                    interfaceDensity === 'compact' ? 'h-12 w-12' : 'h-14 w-14'
                  }`}>
                    <Text className="text-lg font-semibold text-primary">
                      {(item.item.peerUsername || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>

                  <View className="flex-1">
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-base font-semibold text-text">
                            {item.item.peerUsername}
                          </Text>
                          <View className="rounded-full border border-border bg-background-alt/55 px-2 py-0.5">
                            <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-muted">
                              Existing
                            </Text>
                          </View>
                        </View>
                        <Text className="mt-1 text-sm text-muted">{item.item.peerEmail}</Text>
                      </View>

                      <View className="items-end">
                        <Text className="text-xs font-medium text-muted">
                          {formatConversationTime(item.item.lastMessageAt)}
                        </Text>
                        {item.item.unreadCount > 0 ? (
                          <View className="mt-2 min-w-6 rounded-full bg-primary px-2 py-1">
                            <Text className="text-center text-xs font-semibold text-background">
                              {item.item.unreadCount}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <Text
                      className={`text-sm leading-6 text-muted ${
                        interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                      }`}
                    >
                      {getConversationPreview(item.item)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={() =>
                  onOpenChat({
                    peerUserId: item.item.userId,
                    peerUsername: item.item.username,
                  })
                }
                className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
                  surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
                } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
              >
                <View className="flex-row items-center">
                  <View className={`mr-4 items-center justify-center rounded-full bg-primary-soft ${
                    interfaceDensity === 'compact' ? 'h-12 w-12' : 'h-14 w-14'
                  }`}>
                    <Text className="text-lg font-semibold text-primary">
                      {(item.item.username || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>

                  <View className="flex-1">
                    <Text className="text-base font-semibold text-text">{item.item.username}</Text>
                    <Text className="mt-1 text-sm text-muted">{item.item.email}</Text>
                    <View
                      className={`flex-row items-center justify-between ${
                        interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
                      }`}
                    >
                      <SecurityBadge
                        ready={Boolean(item.item.hasPublicKey)}
                        label={item.item.hasPublicKey ? 'Ready for E2EE' : 'No public key yet'}
                      />
                      <Text className="text-xs font-medium text-muted">Start chat</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            )
          )}
        />
      )}

      {selectedConversationAction ? (
        <BottomSheetPanel title="Conversation Actions" onClose={handleCloseConversationActions}>
          <View className="rounded-[18px] bg-background-alt/55 px-3 py-3">
            <Text className="text-[15px] font-medium text-text">
              {selectedConversationAction.peerUsername}
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              {selectedConversationAction.peerEmail}
            </Text>
          </View>

          <Pressable
            onPress={() => {
              togglePinnedConversation(selectedConversationAction.conversationId);
              handleCloseConversationActions();
            }}
            className="mt-2 rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">
              {pinnedConversationIds.includes(selectedConversationAction.conversationId)
                ? 'Unpin conversation'
                : 'Pin conversation'}
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Keep this chat at the top of the list for faster access.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              toggleArchivedConversation(selectedConversationAction.conversationId);
              handleCloseConversationActions();
            }}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">
              {archivedConversationIds.includes(selectedConversationAction.conversationId)
                ? 'Unarchive conversation'
                : 'Archive conversation'}
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              {archivedConversationIds.includes(selectedConversationAction.conversationId)
                ? 'Return this chat to the main conversation list.'
                : 'Move this chat out of the main list without deleting it.'}
            </Text>
          </Pressable>

          {selectedConversationAction.unreadCount > 0 ? (
            <Pressable
              onPress={handleMarkConversationAsRead}
              className="rounded-[18px] px-3 py-3 active:opacity-80"
            >
              <Text className="text-[15px] font-medium text-text">Mark as read</Text>
              <Text className="mt-1 text-[13px] leading-5 text-muted">
                Clear unread state for this conversation on this device.
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={handleCloseConversationActions}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Cancel</Text>
          </Pressable>
        </BottomSheetPanel>
      ) : null}
    </View>
  );
}
