import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Share,
  ToastAndroid,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';

import ScreenHeader from '../components/ScreenHeader';
import ActionRow from '../components/ActionRow';
import Avatar from '../components/Avatar';
import ListRow from '../components/ListRow';
import CreateGroupPanel from '../components/CreateGroupPanel';
import type { GroupView } from '../shared/api/groups.api';
import SectionEyebrow from '../components/SectionEyebrow';
import { userApi, type UserListItem } from '../shared/api/user.api';
import { conversationsApi, type ConversationListItem } from '../shared/api/conversations.api';
import { useAuthStore } from '../store/auth.store';
import { useContactsStore, type SavedContact } from '../store/contacts.store';
import { useProfilesStore } from '../store/profiles.store';
import { DIRECTORY_SEARCH_MIN_LENGTH, filterLocalContacts } from '../shared/contacts/searchLocal';
import { listTrustedPeerUserIds } from '../shared/storage/trustedIdentities';
import { contactSubtitle, formatHandle, shortSecureId } from '../shared/utils/identity';

// B1: flat rows span the full width; only the section labels carry side padding
const listContentContainerStyle = {
  paddingBottom: 24,
};

type ChatOpenHandler = (chat: { peerUserId: string; peerUsername?: string }) => void;
type GroupOpenHandler = (group: { groupId: string; name?: string }) => void;
type VerifyContactHandler = (params: {
  peerUserId: string;
  peerUsername?: string;
  peerEmail?: string;
}) => void;

type DiscoverSection =
  | { type: 'section'; id: string; title: string }
  | { type: 'saved'; id: string; contact: SavedContact; verified: boolean; hasConversation: boolean }
  | { type: 'conversation'; id: string; conversation: ConversationListItem; verified: boolean }
  | { type: 'user'; id: string; user: UserListItem; verified: boolean };

/** What the device holds and can match from the first character (A11); one entry per source, deduplicated by user. */
type LocalCandidate =
  | { peerUserId: string; username?: string; displayName?: string; source: 'saved'; contact: SavedContact }
  | { peerUserId: string; username?: string; displayName?: string; source: 'conversation'; verified: boolean; conversation: ConversationListItem };

type SavedContactEntry = {
  contact: SavedContact;
  hasConversation: boolean;
  verified: boolean;
};

/** Rows of the pre-search "contact hub" list. Discriminated on `type`. */
type HomeRow =
  | { type: 'section'; id: 'saved-header' | 'verified-header' | 'recent-header' }
  | { type: 'saved-contact'; id: string; entry: SavedContactEntry }
  | { type: 'verified-contact'; id: string; conversation: ConversationListItem }
  | { type: 'recent-contact'; id: string; conversation: ConversationListItem };

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-elevated">
        <View className="h-6 w-6 rounded-full bg-primary/30" />
      </View>
      <Text className="mt-5 text-center text-xl font-semibold text-text">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-6 text-muted">{description}</Text>
    </View>
  );
}

function SearchHint() {
  return (
    <Text className="px-6 py-4 text-center text-sm leading-6 text-muted">
      {`Type ${DIRECTORY_SEARCH_MIN_LENGTH} characters to search the directory`}
    </Text>
  );
}

function QuickAction({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      // no flex-1 here: inside a column that made the card's height zero (roadmap §8.1 A6);
      // the two-up row wraps each card in its own flex-1 View
      className="rounded-[18px] border border-border bg-surface/88 p-4 active:opacity-80"
    >
      <Text className="text-sm font-semibold text-text">{title}</Text>
      <Text className="mt-1 text-xs leading-5 text-muted">{subtitle}</Text>
    </Pressable>
  );
}

export default function NewChatScreen({
  onOpenChat,
  onOpenGroup,
  onVerifyContact,
}: {
  onOpenChat: ChatOpenHandler;
  onOpenGroup: GroupOpenHandler;
  onVerifyContact: VerifyContactHandler;
}) {
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const insets = useSafeAreaInsets();
  const myUserId = useAuthStore((s) => s.userId);
  const recentContactIdsByUser = useContactsStore((s) => s.recentContactIdsByUser);
  const savedContactsByUser = useContactsStore((s) => s.savedContactsByUser);
  const saveContact = useContactsStore((s) => s.saveContact);
  const removeSavedContact = useContactsStore((s) => s.removeSavedContact);
  const profilesByUser = useProfilesStore((s) => s.byUser);

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<UserListItem[]>([]);
  // the query the current `users` answer; until it equals the typed query no "not found" is shown
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [trustedPeerUserIds, setTrustedPeerUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const trimmedQuery = useMemo(() => q.trim(), [q]);
  // The device's lists filter from the first character; the directory needs the server's minimum (A11).
  const searching = trimmedQuery.length >= 1;
  const directorySearch = trimmedQuery.length >= DIRECTORY_SEARCH_MIN_LENGTH;
  const recentContactIds = useMemo(
    () => (myUserId ? recentContactIdsByUser[myUserId] ?? [] : []),
    [myUserId, recentContactIdsByUser],
  );
  const savedContacts = useMemo(
    () => (myUserId ? savedContactsByUser[myUserId] ?? [] : []),
    [myUserId, savedContactsByUser],
  );

  const trustedPeerUserIdSet = useMemo(
    () => new Set(trustedPeerUserIds),
    [trustedPeerUserIds],
  );
  const savedContactIdSet = useMemo(
    () => new Set(savedContacts.map((contact) => contact.peerUserId)),
    [savedContacts],
  );

  const savedContactEntries = useMemo(() => {
    return savedContacts.map((contact) => {
      const matchingConversation = conversations.find(
        (conversation) => conversation.peerUserId === contact.peerUserId,
      );

      return {
        contact: {
          ...contact,
          peerUsername: matchingConversation?.peerUsername || contact.peerUsername,
          peerEmail: contact.peerEmail,
        },
        hasConversation: Boolean(matchingConversation),
        verified: trustedPeerUserIdSet.has(contact.peerUserId),
      };
    });
  }, [conversations, savedContacts, trustedPeerUserIdSet]);

  const recentConversations = useMemo(() => {
    const recentOrder = recentContactIds.length > 0
      ? recentContactIds
      : conversations
          .slice()
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
          .map((conversation) => conversation.peerUserId);

    return recentOrder
      .map((peerUserId) =>
        conversations.find((conversation) => conversation.peerUserId === peerUserId),
      )
      .filter((conversation): conversation is ConversationListItem => Boolean(conversation));
  }, [conversations, recentContactIds]);

  const verifiedConversations = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            trustedPeerUserIdSet.has(conversation.peerUserId) &&
            !savedContactIdSet.has(conversation.peerUserId),
        )
        .sort((a, b) => {
          const recentDelta =
            recentContactIds.indexOf(a.peerUserId) - recentContactIds.indexOf(b.peerUserId);

          if (recentDelta !== 0) {
            const aRank = recentContactIds.indexOf(a.peerUserId);
            const bRank = recentContactIds.indexOf(b.peerUserId);

            if (aRank === -1) return 1;
            if (bRank === -1) return -1;
            return recentDelta;
          }

          return b.lastMessageAt - a.lastMessageAt;
        }),
    [conversations, recentContactIds, savedContactIdSet, trustedPeerUserIdSet],
  );

  const visibleRecentConversations = useMemo(
    () =>
      recentConversations.filter(
        (conversation) =>
          !savedContactIdSet.has(conversation.peerUserId) &&
          !verifiedConversations.some(
            (verifiedConversation) =>
              verifiedConversation.peerUserId === conversation.peerUserId,
          ),
      ),
    [recentConversations, savedContactIdSet, verifiedConversations],
  );

  const discoverSections = useMemo<DiscoverSection[]>(() => {
    if (!searching) return [];
    const sections: DiscoverSection[] = [];
    const nameOf = (peerUserId: string) => profilesByUser[peerUserId]?.name;
    const local = filterLocalContacts<LocalCandidate>(trimmedQuery, [
      ...savedContacts.map((contact) => ({ peerUserId: contact.peerUserId, username: contact.peerUsername, displayName: nameOf(contact.peerUserId), source: 'saved' as const, contact })),
      ...verifiedConversations.map((conversation) => ({ peerUserId: conversation.peerUserId, username: conversation.peerUsername, displayName: nameOf(conversation.peerUserId), source: 'conversation' as const, verified: true, conversation })),
      ...recentConversations.map((conversation) => ({ peerUserId: conversation.peerUserId, username: conversation.peerUsername, displayName: nameOf(conversation.peerUserId), source: 'conversation' as const, verified: false, conversation })),
    ]);
    const localIds = new Set(local.map((candidate) => candidate.peerUserId));

    const savedRows: DiscoverSection[] = [];
    const verifiedRows: DiscoverSection[] = [];
    const recentRows: DiscoverSection[] = [];
    for (const candidate of local) {
      if (candidate.source === 'saved') {
        savedRows.push({
          type: 'saved',
          id: `saved-${candidate.peerUserId}`,
          contact: candidate.contact,
          verified: trustedPeerUserIdSet.has(candidate.peerUserId),
          hasConversation: conversations.some((conversation) => conversation.peerUserId === candidate.peerUserId),
        });
      } else if (candidate.verified) {
        verifiedRows.push({ type: 'conversation', id: `verified-${candidate.peerUserId}`, conversation: candidate.conversation, verified: true });
      } else {
        recentRows.push({ type: 'conversation', id: `recent-${candidate.peerUserId}`, conversation: candidate.conversation, verified: false });
      }
    }

    // Directory answers (>= DIRECTORY_SEARCH_MIN_LENGTH characters): anyone not already listed from the device.
    const directoryRows: DiscoverSection[] = [];
    for (const user of users) {
      if (localIds.has(user.userId)) continue;
      if (trustedPeerUserIdSet.has(user.userId)) verifiedRows.push({ type: 'user', id: `verified-${user.userId}`, user, verified: true });
      else directoryRows.push({ type: 'user', id: `directory-${user.userId}`, user, verified: false });
    }

    const pushSection = (id: string, title: string, rows: DiscoverSection[]) => {
      if (rows.length === 0) return;
      sections.push({ type: 'section', id, title });
      sections.push(...rows);
    };
    pushSection('discover-section-saved', 'Saved contacts', savedRows);
    pushSection('discover-section-verified', 'Verified contacts', verifiedRows);
    pushSection('discover-section-recent', 'Recent', recentRows);
    pushSection('discover-section-directory', 'Directory', directoryRows);
    return sections;
  }, [conversations, profilesByUser, recentConversations, savedContacts, searching, trimmedQuery, trustedPeerUserIdSet, users, verifiedConversations]);

  const handleShareInvite = useCallback(async () => {
    if (!myUserId) return;

    const message = `Join me in this secure messenger. Search for my secure ID: ${myUserId}`;
    await Share.share({
      message,
    });
  }, [myUserId]);

  const handleCopyInvite = useCallback(async () => {
    if (!myUserId) return;

    await Clipboard.setString(`secure-id:${myUserId}`);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Invite code copied', ToastAndroid.SHORT);
    }
  }, [myUserId]);

  const renderVerifyAction = useCallback(
    (params: { peerUserId: string; peerUsername?: string; peerEmail?: string; verified: boolean }) => {
      const { peerUserId, peerUsername, peerEmail, verified } = params;
      if (verified) return null;

      return (
        <Pressable
          onPress={() =>
            onVerifyContact({
              peerUserId,
              peerUsername,
              peerEmail,
            })
          }
          className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 active:opacity-80"
        >
          <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-text">
            Verify
          </Text>
        </Pressable>
      );
    },
    [onVerifyContact],
  );

  const renderSaveAction = useCallback(
    (params: { peerUserId: string; peerUsername?: string; peerEmail?: string }) => {
      if (!myUserId) return null;

      const isSaved = savedContactIdSet.has(params.peerUserId);

      return (
        <Pressable
          onPress={() => {
            if (isSaved) {
              removeSavedContact(myUserId, params.peerUserId);
              return;
            }

            saveContact(myUserId, params);
          }}
          className={`rounded-full border px-3 py-1.5 active:opacity-80 ${
            isSaved
              ? 'border-primary/30 bg-primary-soft/60'
              : 'border-border bg-surface-elevated'
          }`}
        >
          <Text
            className={`text-[11px] font-semibold uppercase tracking-[1px] ${
              isSaved ? 'text-primary' : 'text-text'
            }`}
          >
            {isSaved ? 'Saved' : 'Add'}
          </Text>
        </Pressable>
      );
    },
    [myUserId, removeSavedContact, saveContact, savedContactIdSet],
  );

  /** B1: every person on this screen is one list row: avatar, name with a verified mark, one line, the Verify / Add actions. */
  const renderPerson = useCallback(
    (p: { peerUserId: string; peerUsername?: string; peerEmail?: string; title: string; subtitle: string; hasPublicKey: boolean | null; verified: boolean }) => {
      const noKey = p.hasPublicKey === false;
      return (
        <ListRow
          avatar={<Avatar name={p.title || '?'} profile={profilesByUser[p.peerUserId] ?? null} size="list" />}
          title={p.title}
          titleIcon={p.verified ? 'badge-check' : undefined}
          subtitle={noKey ? 'No encryption key yet' : p.subtitle}
          subtitleTone={noKey ? 'warning' : 'muted'}
          subtitleIcon={noKey ? 'key-round' : undefined}
          trailing={
            <>
              {renderVerifyAction({ peerUserId: p.peerUserId, peerUsername: p.peerUsername, peerEmail: p.peerEmail, verified: p.verified })}
              {renderSaveAction({ peerUserId: p.peerUserId, peerUsername: p.peerUsername, peerEmail: p.peerEmail })}
            </>
          }
          onPress={() => onOpenChat({ peerUserId: p.peerUserId, peerUsername: p.peerUsername })}
        />
      );
    },
    [onOpenChat, profilesByUser, renderSaveAction, renderVerifyAction],
  );

  async function loadUsers(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await userApi.getUsers({ q: query || undefined, limit: 50 });
      setUsers(res.data.items);
      setSearchedQuery(query);
    } catch (e: any) {
      setError(e?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  const loadContactsOverview = useCallback(async () => {
    if (!myUserId) {
      setContactsLoading(false);
      return;
    }

    setContactsLoading(true);
    setContactsError(null);

    try {
      const [conversationRes, trustedIds] = await Promise.all([
        conversationsApi.list(),
        listTrustedPeerUserIds(myUserId),
      ]);

      setConversations(conversationRes.data.items);
      setTrustedPeerUserIds(trustedIds);
    } catch (e: any) {
      setContactsError(e?.message || 'Failed to load recent contacts');
    } finally {
      setContactsLoading(false);
    }
  }, [myUserId]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        loadContactsOverview(),
        directorySearch
          ? userApi.getUsers({ q: trimmedQuery, limit: 50 }).then((res) => {
              setUsers(res.data.items);
              setSearchedQuery(trimmedQuery);
              setError(null);
            })
          : Promise.resolve(),
      ]);
    } catch (e: any) {
      if (directorySearch) {
        setError(e?.message || 'Failed to refresh users');
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadContactsOverview();
  }, [loadContactsOverview]);

  useFocusEffect(
    useCallback(() => {
      loadContactsOverview();
    }, [loadContactsOverview]),
  );

  useEffect(() => {
    if (!directorySearch) {
      setUsers([]);
      setSearchedQuery(null);
      setError(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      loadUsers(trimmedQuery);
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedQuery, directorySearch]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScreenHeader title="New Chat" />
      <View className="px-4">
        <View className="mt-2.5 rounded-[20px] border border-border bg-surface/82 px-4 py-1">
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by username"
            placeholderTextColor="#94A3B8"
            className="py-3 text-[15px] text-text"
            autoCapitalize="none"
          />
        </View>

        {myUserId ? (
          <View className="mt-2.5 flex-row gap-3">
            <View className="flex-1">
              <QuickAction
                title="Invite"
                subtitle="Share your secure ID through another app."
                onPress={handleShareInvite}
              />
            </View>
            <View className="flex-1">
              <QuickAction
                title="Copy ID"
                subtitle="Copy your invite code for email or notes."
                onPress={handleCopyInvite}
              />
            </View>
          </View>
        ) : null}
        {myUserId && !searching ? (
          <ActionRow
            icon="users"
            title="New group"
            subtitle="Encrypted end to end for every member"
            onPress={() => setShowCreateGroup(true)}
            testID="new-group-row"
            className="mt-2.5"
          />
        ) : null}
      </View>

      {!searching && !contactsLoading && !contactsError && verifiedConversations.length === 0 ? (
        <View className="mx-5 mt-4 rounded-[22px] border border-border bg-surface/88 p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-[1.3px] text-primary">
            Trust First
          </Text>
          <Text className="mt-2 text-base font-semibold text-text">Verify people before you rely on a chat.</Text>
          <Text className="mt-1 text-sm leading-6 text-muted">
            Open any recent conversation or search result, compare the safety number, and trusted contacts will stay pinned here.
          </Text>
        </View>
      ) : null}

      {!searching && contactsLoading && (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Loading recent and verified contacts...</Text>
        </View>
      )}

      {!searching && !contactsLoading && contactsError && (
        <View className="mx-5 mt-5 rounded-[24px] border border-danger/40 bg-danger/10 p-5">
          <Text className="text-base font-semibold text-danger">Unable to load contacts overview</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{contactsError}</Text>
          <Pressable
            onPress={loadContactsOverview}
            className="mt-4 self-start rounded-full bg-surface-elevated px-4 py-2 active:opacity-80"
          >
            <Text className="font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!searching && !contactsLoading && !contactsError && (
        <FlatList<HomeRow>
          data={[
            ...(savedContactEntries.length > 0
              ? [{ type: 'section' as const, id: 'saved-header' as const }]
              : []),
            ...savedContactEntries.map((entry) => ({
              type: 'saved-contact' as const,
              id: `saved-home-${entry.contact.peerUserId}`,
              entry,
            })),
            ...(verifiedConversations.length > 0
              ? [{ type: 'section' as const, id: 'verified-header' as const }]
              : []),
            ...verifiedConversations.map((conversation) => ({
              type: 'verified-contact' as const,
              id: `verified-${conversation.conversationId}`,
              conversation,
            })),
            ...(visibleRecentConversations.length > 0
              ? [{ type: 'section' as const, id: 'recent-header' as const }]
              : []),
            ...visibleRecentConversations
              .map((conversation) => ({
                type: 'recent-contact' as const,
                id: `recent-${conversation.conversationId}`,
                conversation,
              })),
          ]}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94A3B8" />
          }
          className="mt-3"
          contentContainerStyle={listContentContainerStyle}
          ListEmptyComponent={
            <EmptyState
              title="No recent chats yet"
              description="Start a conversation below or verify a contact to build your trusted list."
            />
          }
          renderItem={({ item }) => {
            if (item.type === 'section') {
              const isSaved = item.id === 'saved-header';
              const isVerified = item.id === 'verified-header';

              return (
                <View className="px-3 pt-2">
                  <SectionEyebrow title={isSaved ? 'Saved contacts' : isVerified ? 'Verified contacts' : 'Recent'} compact />
                </View>
              );
            }

            if (item.type === 'saved-contact') {
              const { contact, verified } = item.entry;
              return renderPerson({
                peerUserId: contact.peerUserId,
                peerUsername: contact.peerUsername,
                peerEmail: contact.peerEmail,
                title: contact.peerUsername || contact.peerUserId,
                subtitle: contactSubtitle({ username: contact.peerUsername, userId: contact.peerUserId }),
                hasPublicKey: null,
                verified,
              });
            }

            const conversation = item.conversation;
            return renderPerson({
              peerUserId: conversation.peerUserId,
              peerUsername: conversation.peerUsername,
              title: conversation.peerUsername,
              subtitle: formatHandle(conversation.peerUsername),
              hasPublicKey: conversation.peerHasPublicKey,
              verified: item.type === 'verified-contact',
            });
          }}
        />
      )}

      {loading && (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Looking up contacts...</Text>
        </View>
      )}

      {!loading && error && (
        <View className="mx-5 mt-5 rounded-[24px] border border-danger/40 bg-danger/10 p-5">
          <Text className="text-base font-semibold text-danger">Unable to load contacts</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{error}</Text>
          <Pressable
            onPress={onRefresh}
            className="mt-4 self-start rounded-full bg-surface-elevated px-4 py-2 active:opacity-80"
          >
            <Text className="font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && searching && (
        <FlatList
          data={discoverSections}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94A3B8" />
          }
          className="mt-3"
          contentContainerStyle={listContentContainerStyle}
          ListEmptyComponent={
            !directorySearch ? (
              <SearchHint />
            ) : searchedQuery === trimmedQuery ? (
              <EmptyState title="No contacts found" description="Try a different username." />
            ) : null
          }
          ListFooterComponent={!directorySearch && discoverSections.length > 0 ? <SearchHint /> : null}
          renderItem={({ item }) => {
            if (item.type === 'section') {
              return (
                <View className="px-3 pt-2">
                  <SectionEyebrow title={item.title} compact />
                </View>
              );
            }

            if (item.type === 'conversation') {
              const conversation = item.conversation;
              return renderPerson({
                peerUserId: conversation.peerUserId,
                peerUsername: conversation.peerUsername,
                title: conversation.peerUsername,
                subtitle: formatHandle(conversation.peerUsername),
                hasPublicKey: conversation.peerHasPublicKey,
                verified: item.verified,
              });
            }

            if (item.type === 'saved') {
              return renderPerson({
                peerUserId: item.contact.peerUserId,
                peerUsername: item.contact.peerUsername,
                peerEmail: item.contact.peerEmail,
                title: item.contact.peerUsername || item.contact.peerUserId,
                subtitle: contactSubtitle({ username: item.contact.peerUsername, userId: item.contact.peerUserId }),
                hasPublicKey: null,
                verified: item.verified,
              });
            }

            return renderPerson({
              peerUserId: item.user.userId,
              peerUsername: item.user.username,
              title: item.user.username,
              subtitle: shortSecureId(item.user.userId),
              hasPublicKey: Boolean(item.user.hasPublicKey),
              verified: item.verified,
            });
          }}
        />
      )}

      {showCreateGroup ? (
        <CreateGroupPanel
          onClose={() => setShowCreateGroup(false)}
          onCreated={(group: GroupView) => {
            setShowCreateGroup(false);
            onOpenGroup({ groupId: group.groupId, name: group.name });
          }}
        />
      ) : null}
    </View>
  );
}
