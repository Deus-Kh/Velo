import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Icon } from '../components/Icon';
import { useThemeColors } from '../theme/useThemeColors';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  BackHandler,
  RefreshControl,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenHeader, { HeaderIconButton } from '../components/ScreenHeader';
import SectionEyebrow from '../components/SectionEyebrow';
import type { ConversationListItem } from '../shared/api/conversations.api';
import { useAuthStore } from '../store/auth.store';
import { useAppearanceStore } from '../store/appearance.store';
import { useChatListStore } from '../store/chat-list.store';
import { useAppUiStore } from '../store/app-ui.store';
import { selectBlockedIds, useBlocksStore } from '../store/blocks.store';
import { blockPeer, unblockPeer } from '../shared/chat/blocks';
import { useProfilesStore } from '../store/profiles.store';
import ArchivedRow from '../components/chatlist/ArchivedRow';
import ConversationActionsSheet from '../components/chatlist/ConversationActionsSheet';
import ConversationRow from '../components/chatlist/ConversationRow';
import GroupRow from '../components/chatlist/GroupRow';
import MessageHitRow from '../components/chatlist/MessageHitRow';
import UserRow from '../components/chatlist/UserRow';
import { ChatListSkeleton, EmptyState, InlineSearchLoading } from '../components/chatlist/ChatListStates';
import { buildHomeListItems, buildSearchResultItems, sortConversations } from '../shared/chat/conversationList';
import { useConversationList } from '../shared/chat/useConversationList';
import { useGroupList } from '../shared/chat/useGroupList';

type ChatOpenHandler = (chat: { peerUserId: string; peerUsername?: string; jumpToMessageId?: string }) => void;
type GroupOpenHandler = (group: { groupId: string; name?: string; jumpToMessageId?: string }) => void;

type SelectedConversationAction = {
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
  unreadCount: number;
};

const ARCHIVE_REVEAL_DRAG_TRIGGER = 28;
const ARCHIVE_REVEAL_HIT_ZONE_HEIGHT = 28;
const ARCHIVE_REVEAL_HORIZONTAL_TOLERANCE = 10;

/**
 * The home list: groups, pinned and regular chats, the archive, and the
 * search over contacts, the directory and stored messages. The data lives
 * in `useConversationList` / `useGroupList`; the rows and the sheet are
 * components under `components/chatlist` (C1).
 */
export default function ChatListScreen({
  onOpenChat,
  onOpenGroup,
  onNewChat,
  recentlyClosedChatPeerUserId,
  onHandledClosedChat,
  active = true,
}: {
  onOpenChat: ChatOpenHandler;
  onOpenGroup: GroupOpenHandler;
  /** B2: the header's "new chat" action; the tabs host switches to the New Chat tab. */
  onNewChat: () => void;
  recentlyClosedChatPeerUserId: string | null;
  onHandledClosedChat: () => void;
  /** this tab is the one on screen (all tabs stay mounted in MainTabsScreen's pager) */
  active?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const myUserId = useAuthStore((s) => s.userId);
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const pinnedConversationIds = useChatListStore((s) => s.pinnedConversationIds);
  const archivedConversationIds = useChatListStore((s) => s.archivedConversationIds);
  const togglePinnedConversation = useChatListStore((s) => s.togglePinnedConversation);
  const toggleArchivedConversation = useChatListStore((s) => s.toggleArchivedConversation);
  const activeChatPeerUserId = useAppUiStore((s) => s.activeChatPeerUserId);
  const blockedIds = useBlocksStore(selectBlockedIds(myUserId));
  const profiles = useProfilesStore((s) => s.byUser); // T7.7

  const [q, setQ] = useState('');
  // B2: the search field lives behind the header's search icon; Back or the x closes it
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchFocusedRef = useRef(false);
  const [selectedConversationAction, setSelectedConversationAction] =
    useState<SelectedConversationAction | null>(null);
  const [showArchivedView, setShowArchivedView] = useState(false);
  const homeListOffsetRef = useRef(0);
  const archiveRevealTriggeredRef = useRef(false);
  const [archivePeekVisible, setArchivePeekVisible] = useState(false);

  const trimmedQuery = useMemo(() => q.trim(), [q]);
  const showingSearch = trimmedQuery.length > 0;
  const canSearch = useMemo(
    () => trimmedQuery.length === 0 || trimmedQuery.length >= 2,
    [trimmedQuery]
  );

  const groupList = useGroupList({ myUserId, activeChatPeerUserId });
  const { groups } = groupList;
  const {
    conversations,
    loading,
    error,
    refreshing,
    searchItems,
    messageHits,
    previewFor,
    groupPreviewFor,
    refreshConversationsSilently,
    onRefresh,
    markConversationRead,
  } = useConversationList({
    myUserId,
    isAuthenticated,
    activeChatPeerUserId,
    trimmedQuery,
    showingSearch,
    canSearch,
    recentlyClosedChatPeerUserId,
    onHandledClosedChat,
    groupList,
  });

  const openSearch = useCallback(() => {
    searchFocusedRef.current = false;
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => {
    setQ('');
    setSearchOpen(false);
  }, []);
  // A8: focus once the field has a layout; an earlier focus does not raise the keyboard
  const focusSearchOnLayout = useCallback(() => {
    if (searchFocusedRef.current) return;
    searchFocusedRef.current = true;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  // Back closes the search field, then the archived view; otherwise it is not ours (A7).
  useEffect(() => {
    if (!active || (!searchOpen && !showArchivedView)) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchOpen) closeSearch();
      else setShowArchivedView(false);
      return true;
    });
    return () => subscription.remove();
  }, [active, closeSearch, searchOpen, showArchivedView]);
  // B1: flat rows span the full width; only the section labels carry side padding
  const listContentContainerStyle = useMemo(
    () => ({
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
        (item) => !archivedConversationIds.includes(item.conversationId) && !blockedIds.includes(item.peerUserId), // T7.5
      ),
    [archivedConversationIds, blockedIds, sortedConversations],
  );
  const archivedConversations = useMemo(
    () =>
      sortedConversations.filter((item) =>
        archivedConversationIds.includes(item.conversationId),
      ),
    [archivedConversationIds, sortedConversations],
  );
  const homeListItems = useMemo(
    () => buildHomeListItems({ groups, activeConversations, pinnedConversationIds }),
    [activeConversations, groups, pinnedConversationIds],
  );
  const matchingConversations = useMemo(() => {
    if (!showingSearch) return [];

    const query = trimmedQuery.toLowerCase();
    return sortedConversations.filter((item) => {
      const username = item.peerUsername?.toLowerCase() ?? '';
      return username.includes(query);
    });
  }, [showingSearch, sortedConversations, trimmedQuery]);
  const matchingSearchContacts = useMemo(() => {
    const existingPeerIds = new Set(sortedConversations.map((item) => item.peerUserId));
    return searchItems.filter((item) => !existingPeerIds.has(item.userId));
  }, [searchItems, sortedConversations]);
  const searchResultItems = useMemo(
    () => buildSearchResultItems({ matchingConversations, matchingSearchContacts, messageHits, groups, profiles, sortedConversations }),
    [groups, matchingConversations, matchingSearchContacts, messageHits, profiles, sortedConversations],
  );
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
    if (!shouldAllowArchiveReveal) {
      setArchivePeekVisible(false);
    }
  }, [shouldAllowArchiveReveal]);

  const handleOpenConversationActions = useCallback((item: ConversationListItem) => {
    setSelectedConversationAction({
      conversationId: item.conversationId,
      peerUserId: item.peerUserId,
      peerUsername: item.peerUsername,
      unreadCount: item.unreadCount,
    });
  }, []);

  const handleCloseConversationActions = useCallback(() => {
    setSelectedConversationAction(null);
  }, []);

  const handleMarkConversationAsRead = useCallback(async () => {
    if (!selectedConversationAction) return;

    const { conversationId, peerUserId } = selectedConversationAction;

    const work = markConversationRead(conversationId, peerUserId);
    setSelectedConversationAction(null);
    await work;
  }, [markConversationRead, selectedConversationAction]);

  const handleToggleBlock = useCallback(
    (peer: string) => {
      if (!myUserId) return;
      const action = blockedIds.includes(peer) ? unblockPeer(myUserId, peer) : blockPeer(myUserId, peer);
      action.then(refreshConversationsSilently).catch((e) => console.warn('[ChatListScreen] block change failed:', e));
    },
    [blockedIds, myUserId, refreshConversationsSilently],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={showArchivedView ? 'Archived' : 'Chats'}
        actions={
          // B2: the header keeps the title, a search icon and a "new chat" action; "Log out" lives in Settings → Account
          showArchivedView ? (
            <HeaderIconButton icon="chevron-left" label="Back to chats" onPress={() => setShowArchivedView(false)} />
          ) : (
            <View className="flex-row items-center gap-2">
              <HeaderIconButton icon="search" label="Search" onPress={openSearch} testID="chat-list-search" />
              <HeaderIconButton icon="square-pen" label="New chat" onPress={onNewChat} testID="chat-list-new-chat" />
            </View>
          )
        }
      />
      {searchOpen ? (
        <View className="px-4">
          <View
            className={`mt-3 flex-row items-center rounded-[20px] border border-border bg-surface-elevated pl-4 pr-2 ${
              interfaceDensity === 'compact' ? 'py-0.5' : 'py-1'
            }`}
          >
            <Icon lib="Lucide" name="search" size={18} color={colors.muted} />
            <TextInput
              ref={searchInputRef}
              onLayout={focusSearchOnLayout}
              value={q}
              onChangeText={setQ}
              placeholder="Search"
              placeholderTextColor="#94A3B8"
              selectionColor="#2DD4BF"
              cursorColor="#2DD4BF"
              underlineColorAndroid="transparent"
              autoCapitalize="none"
              returnKeyType="search"
              className="ml-2 flex-1 py-3 text-[15px] text-text"
            />
            <Pressable onPress={closeSearch} accessibilityRole="button" accessibilityLabel="Close search" className="h-9 w-9 items-center justify-center rounded-full active:opacity-80">
              <Icon lib="Lucide" name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      ) : null}

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

      {!loading && !error && !showingSearch && !showArchivedView && activeConversations.length === 0 && archivedConversations.length === 0 && groups.length === 0 && (
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
          description="Try a different username to find an existing chat or start a new one."
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
          onPress={() => {
            closeSearch();
            setShowArchivedView(true);
          }}
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
            className="mt-2"
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
                <View className="px-3 pt-2">
                  <SectionEyebrow title={item.label} compact />
                </View>
              ) : item.type === 'group' ? (
                <GroupRow
                  group={item.group}
                  preview={groupPreviewFor(item.group)}
                  onPress={() => onOpenGroup({ groupId: item.group.groupId, name: item.group.name })}
                />
              ) : (
                <ConversationRow
                  item={item.item}
                  title={profiles[item.item.peerUserId]?.name?.trim() || item.item.peerUsername}
                  profile={profiles[item.item.peerUserId] ?? null}
                  preview={previewFor(item.item)}
                  pinned={pinnedConversationIds.includes(item.item.conversationId)}
                  blocked={blockedIds.includes(item.item.peerUserId)}
                  onPress={() =>
                    onOpenChat({
                      peerUserId: item.item.peerUserId,
                      peerUsername: item.item.peerUsername,
                    })
                  }
                  onLongPress={() => handleOpenConversationActions(item.item)}
                />
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
          className="mt-2"
          contentContainerStyle={listContentContainerStyle}
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              title={profiles[item.peerUserId]?.name?.trim() || item.peerUsername}
              profile={profiles[item.peerUserId] ?? null}
              preview={previewFor(item)}
              pinned={false}
              blocked={blockedIds.includes(item.peerUserId)}
              onPress={() =>
                onOpenChat({
                  peerUserId: item.peerUserId,
                  peerUsername: item.peerUsername,
                })
              }
              onLongPress={() => handleOpenConversationActions(item)}
            />
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
          className="mt-2"
          contentContainerStyle={listContentContainerStyle}
          renderItem={({ item }) => (
            item.type === 'section' ? (
              <View className="px-3 pt-2">
                <SectionEyebrow title={item.label} compact />
              </View>
            ) : item.type === 'message' ? (
              <MessageHitRow
                title={item.title}
                hit={item.hit}
                profile={profiles[item.hit.peerKey] ?? null}
                onPress={() => {
                  const { hit } = item;
                  if (hit.peerKey.startsWith('group:')) onOpenGroup({ groupId: hit.peerKey.slice('group:'.length), name: item.title, jumpToMessageId: hit.message.id });
                  else onOpenChat({ peerUserId: hit.peerKey, peerUsername: sortedConversations.find((c) => c.peerUserId === hit.peerKey)?.peerUsername, jumpToMessageId: hit.message.id });
                }}
              />
            ) : item.type === 'conversation' ? (
              <ConversationRow
                item={item.item}
                title={profiles[item.item.peerUserId]?.name?.trim() || item.item.peerUsername}
                profile={profiles[item.item.peerUserId] ?? null}
                preview={previewFor(item.item)}
                pinned={pinnedConversationIds.includes(item.item.conversationId)}
                blocked={blockedIds.includes(item.item.peerUserId)}
                onPress={() =>
                  onOpenChat({
                    peerUserId: item.item.peerUserId,
                    peerUsername: item.item.peerUsername,
                  })
                }
                onLongPress={() => handleOpenConversationActions(item.item)}
              />
            ) : (
              <UserRow
                user={item.item}
                profile={profiles[item.item.userId] ?? null}
                onPress={() =>
                  onOpenChat({
                    peerUserId: item.item.userId,
                    peerUsername: item.item.username,
                  })
                }
              />
            )
          )}
        />
      )}

      {selectedConversationAction ? (
        <ConversationActionsSheet
          peerUsername={selectedConversationAction.peerUsername}
          unreadCount={selectedConversationAction.unreadCount}
          pinned={pinnedConversationIds.includes(selectedConversationAction.conversationId)}
          archived={archivedConversationIds.includes(selectedConversationAction.conversationId)}
          blocked={blockedIds.includes(selectedConversationAction.peerUserId)}
          onTogglePin={() => togglePinnedConversation(selectedConversationAction.conversationId)}
          onToggleArchive={() => toggleArchivedConversation(selectedConversationAction.conversationId)}
          onToggleBlock={() => handleToggleBlock(selectedConversationAction.peerUserId)}
          onMarkAsRead={handleMarkConversationAsRead}
          onClose={handleCloseConversationActions}
        />
      ) : null}
    </View>
  );
}
