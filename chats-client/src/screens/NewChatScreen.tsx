import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import SectionEyebrow from '../components/SectionEyebrow';
import { userApi, type UserListItem } from '../shared/api/user.api';
import { conversationsApi, type ConversationListItem } from '../shared/api/conversations.api';
import { useAuthStore } from '../store/auth.store';
import { useContactsStore, type SavedContact } from '../store/contacts.store';
import { listTrustedPeerUserIds } from '../shared/storage/trustedIdentities';

const listContentContainerStyle = {
  paddingHorizontal: 20,
  paddingBottom: 24,
};

type ChatOpenHandler = (chat: { peerUserId: string; peerUsername?: string }) => void;
type VerifyContactHandler = (params: {
  peerUserId: string;
  peerUsername?: string;
  peerEmail?: string;
}) => void;

type DiscoverSection =
  | { type: 'section'; id: string; title: string; description?: string }
  | { type: 'saved'; id: string; contact: SavedContact; verified: boolean; hasConversation: boolean }
  | { type: 'user'; id: string; user: UserListItem; verified: boolean };

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

function SecurityBadge({
  ready,
  label,
}: {
  ready: boolean;
  label: string;
}) {
  return (
    <View
      className={`rounded-full border px-3 py-1 ${
        ready ? 'border-primary/30 bg-primary-soft/60' : 'border-warning/30 bg-warning/10'
      }`}
    >
      <Text className={`text-xs font-semibold ${ready ? 'text-primary' : 'text-warning'}`}>
        {label}
      </Text>
    </View>
  );
}

function ContactRow({
  title,
  subtitle,
  avatarSeed,
  onPress,
  badges,
  trailing,
  action,
  topAction,
}: {
  title: string;
  subtitle: string;
  avatarSeed: string;
  onPress: () => void;
  badges?: ReactNode;
  trailing?: ReactNode;
  action?: ReactNode;
  topAction?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="mb-3 rounded-[20px] border border-border bg-surface/88 p-4 active:opacity-80"
    >
      <View className="flex-row items-center">
        <View className="mr-4 h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
          <Text className="text-lg font-semibold text-primary">
            {(avatarSeed || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>

        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-base font-semibold text-text">{title}</Text>
            {topAction}
          </View>
          <Text className="mt-1 text-sm text-muted">{subtitle}</Text>

          {badges ? (
            <View className="mt-3 flex-row items-center justify-between">
              <View className="flex-row flex-wrap items-center gap-2">{badges}</View>
              <View className="flex-row items-center gap-2">
                {action}
                {trailing}
              </View>
            </View>
          ) : trailing ? (
            <View className="mt-3 flex-row items-center justify-end">{trailing}</View>
          ) : null}
        </View>
      </View>
    </Pressable>
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
      className="flex-1 rounded-[18px] border border-border bg-surface/88 p-4 active:opacity-80"
    >
      <Text className="text-sm font-semibold text-text">{title}</Text>
      <Text className="mt-1 text-xs leading-5 text-muted">{subtitle}</Text>
    </Pressable>
  );
}

export default function NewChatScreen({
  onOpenChat,
  onVerifyContact,
}: {
  onOpenChat: ChatOpenHandler;
  onVerifyContact: VerifyContactHandler;
}) {
  const insets = useSafeAreaInsets();
  const myUserId = useAuthStore((s) => s.userId);
  const recentContactIdsByUser = useContactsStore((s) => s.recentContactIdsByUser);
  const savedContactsByUser = useContactsStore((s) => s.savedContactsByUser);
  const saveContact = useContactsStore((s) => s.saveContact);
  const removeSavedContact = useContactsStore((s) => s.removeSavedContact);

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [trustedPeerUserIds, setTrustedPeerUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const trimmedQuery = useMemo(() => q.trim(), [q]);
  const canSearch = trimmedQuery.length >= 2;
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
          peerEmail: matchingConversation?.peerEmail || contact.peerEmail,
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
        .filter((conversation) => trustedPeerUserIdSet.has(conversation.peerUserId))
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
    [conversations, recentContactIds, trustedPeerUserIdSet],
  );

  const discoverSections = useMemo<DiscoverSection[]>(() => {
    const sections: DiscoverSection[] = [];
    const savedResults = savedContacts
      .filter((contact) => {
        const query = trimmedQuery.toLowerCase();
        return (
          (contact.peerUsername || '').toLowerCase().includes(query) ||
          (contact.peerEmail || '').toLowerCase().includes(query)
        );
      })
      .map((contact) => ({
        type: 'saved' as const,
        id: `saved-${contact.peerUserId}`,
        contact,
        verified: trustedPeerUserIdSet.has(contact.peerUserId),
        hasConversation: conversations.some(
          (conversation) => conversation.peerUserId === contact.peerUserId,
        ),
      }));

    if (savedResults.length > 0) {
      sections.push({
        type: 'section',
        id: 'discover-section-saved',
        title: 'Saved Contacts',
        description: 'People you saved locally for quick access.',
      });
      sections.push(...savedResults);
    }

    const verifiedResults = users.filter((user) => trustedPeerUserIdSet.has(user.userId));
    const unverifiedResults = users.filter(
      (user) =>
        !trustedPeerUserIdSet.has(user.userId) &&
        !savedContactIdSet.has(user.userId),
    );

    if (verifiedResults.length > 0) {
      sections.push({
        type: 'section',
        id: 'discover-section-verified',
        title: 'Verified Contacts',
        description: 'People you already trusted on this device.',
      });
      sections.push(
        ...verifiedResults.map((user) => ({
          type: 'user' as const,
          id: `verified-${user.userId}`,
          user,
          verified: true,
        })),
      );
    }

    if (unverifiedResults.length > 0) {
      sections.push({
        type: 'section',
        id: 'discover-section-discover',
        title: verifiedResults.length > 0 ? 'Other Results' : 'Discover',
        description: 'Start a secure chat with anyone who already has encryption keys.',
      });
      sections.push(
        ...unverifiedResults.map((user) => ({
          type: 'user' as const,
          id: `discover-${user.userId}`,
          user,
          verified: false,
        })),
      );
    }

    return sections;
  }, [conversations, savedContactIdSet, savedContacts, trimmedQuery, trustedPeerUserIdSet, users]);

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

  async function loadUsers(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await userApi.getUsers({ q: query || undefined, limit: 50 });
      setUsers(res.data.items);
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
        canSearch
          ? userApi.getUsers({ q: trimmedQuery, limit: 50 }).then((res) => {
              setUsers(res.data.items);
              setError(null);
            })
          : Promise.resolve(),
      ]);
    } catch (e: any) {
      if (canSearch) {
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
    if (!canSearch) {
      setUsers([]);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      loadUsers(trimmedQuery);
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedQuery, canSearch]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title="New Chat"
        subtitle="Start a private conversation with a saved or verified contact."
      />
      <View className="px-4">
        <View className="mt-2.5 rounded-[20px] border border-border bg-surface/82 px-4 py-1">
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by username or email"
            placeholderTextColor="#94A3B8"
            className="py-3 text-[15px] text-text"
            autoCapitalize="none"
          />
        </View>

        {myUserId ? (
          <View className="mt-2.5 flex-row gap-3">
            <QuickAction
              title="Invite"
              subtitle="Share your secure ID through another app."
              onPress={handleShareInvite}
            />
            <QuickAction
              title="Copy ID"
              subtitle="Copy your invite code for email or notes."
              onPress={handleCopyInvite}
            />
          </View>
        ) : null}
      </View>

      {!canSearch && !contactsLoading && !contactsError && verifiedConversations.length === 0 ? (
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

      {!canSearch && contactsLoading && (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Loading recent and verified contacts...</Text>
        </View>
      )}

      {!canSearch && !contactsLoading && contactsError && (
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

      {!canSearch && !contactsLoading && !contactsError && (
        <FlatList
          data={[
            ...(savedContactEntries.length > 0
              ? [{ type: 'section', id: 'saved-header' as const }]
              : []),
            ...savedContactEntries.map((entry) => ({
              type: 'saved-contact' as const,
              id: `saved-home-${entry.contact.peerUserId}`,
              entry,
            })),
            ...(verifiedConversations.length > 0
              ? [{ type: 'section', id: 'verified-header' as const }]
              : []),
            ...verifiedConversations.map((conversation) => ({
              type: 'verified-contact' as const,
              id: `verified-${conversation.conversationId}`,
              conversation,
            })),
            ...(recentConversations.length > 0
              ? [{ type: 'section', id: 'recent-header' as const }]
              : []),
            ...recentConversations
              .filter(
                (conversation) =>
                  !verifiedConversations.some(
                    (verifiedConversation) =>
                      verifiedConversation.peerUserId === conversation.peerUserId,
                  ),
              )
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
                <SectionEyebrow
                  title={isSaved ? 'Saved Contacts' : isVerified ? 'Verified Contacts' : 'Recent'}
                  description={
                    isSaved
                      ? 'People you explicitly saved on this device.'
                      : isVerified
                      ? 'Trusted identities on this device.'
                      : 'People you talked to recently.'
                  }
                  compact
                />
              );
            }

            if (item.type === 'saved-contact') {
              const { contact, verified, hasConversation } = item.entry;

              return (
                <ContactRow
                  title={contact.peerUsername || contact.peerUserId}
                  subtitle={contact.peerEmail || contact.peerUserId}
                  avatarSeed={contact.peerUsername || contact.peerUserId}
                  onPress={() =>
                    onOpenChat({
                      peerUserId: contact.peerUserId,
                      peerUsername: contact.peerUsername,
                    })
                  }
                  badges={
                    <>
                      {verified ? <SecurityBadge ready label="Verified" /> : null}
                      <SecurityBadge ready={hasConversation} label={hasConversation ? 'Recent chat' : 'Saved only'} />
                    </>
                  }
                  action={renderVerifyAction({
                    peerUserId: contact.peerUserId,
                    peerUsername: contact.peerUsername,
                    peerEmail: contact.peerEmail,
                    verified,
                  })}
                  topAction={renderSaveAction({
                    peerUserId: contact.peerUserId,
                    peerUsername: contact.peerUsername,
                    peerEmail: contact.peerEmail,
                  })}
                  trailing={<Text className="text-xs font-medium text-muted">Open chat</Text>}
                />
              );
            }

            const conversation = item.conversation;
            const isVerified = item.type === 'verified-contact';

            return (
              <ContactRow
                title={conversation.peerUsername}
                subtitle={conversation.peerEmail}
                avatarSeed={conversation.peerUsername}
                onPress={() =>
                  onOpenChat({
                    peerUserId: conversation.peerUserId,
                    peerUsername: conversation.peerUsername,
                  })
                }
                badges={
                  <>
                    {isVerified ? <SecurityBadge ready label="Verified" /> : null}
                    <SecurityBadge
                      ready={conversation.peerHasPublicKey}
                      label={conversation.peerHasPublicKey ? 'Ready for E2EE' : 'No public key yet'}
                    />
                  </>
                }
                action={renderVerifyAction({
                  peerUserId: conversation.peerUserId,
                  peerUsername: conversation.peerUsername,
                  peerEmail: conversation.peerEmail,
                  verified: isVerified,
                })}
                topAction={renderSaveAction({
                  peerUserId: conversation.peerUserId,
                  peerUsername: conversation.peerUsername,
                  peerEmail: conversation.peerEmail,
                })}
                trailing={<Text className="text-xs font-medium text-muted">Open chat</Text>}
              />
            );
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

      {!loading && !error && canSearch && users.length === 0 && (
        <EmptyState
          title="No contacts found"
          description="Try a different username or email."
        />
      )}

      {!loading && !error && canSearch && users.length > 0 && (
        <FlatList
          data={discoverSections}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94A3B8" />
          }
          className="mt-3"
          contentContainerStyle={listContentContainerStyle}
          renderItem={({ item }) => {
            if (item.type === 'section') {
              return <SectionEyebrow title={item.title} description={item.description} compact />;
            }

            if (item.type === 'saved') {
              return (
                <ContactRow
                  title={item.contact.peerUsername || item.contact.peerUserId}
                  subtitle={item.contact.peerEmail || item.contact.peerUserId}
                  avatarSeed={item.contact.peerUsername || item.contact.peerUserId}
                  onPress={() =>
                    onOpenChat({
                      peerUserId: item.contact.peerUserId,
                      peerUsername: item.contact.peerUsername,
                    })
                  }
                  badges={
                    <>
                      {item.verified ? <SecurityBadge ready label="Verified" /> : null}
                      <SecurityBadge
                        ready={item.hasConversation}
                        label={item.hasConversation ? 'Recent chat' : 'Saved only'}
                      />
                    </>
                  }
                  action={renderVerifyAction({
                    peerUserId: item.contact.peerUserId,
                    peerUsername: item.contact.peerUsername,
                    peerEmail: item.contact.peerEmail,
                    verified: item.verified,
                  })}
                  topAction={renderSaveAction({
                    peerUserId: item.contact.peerUserId,
                    peerUsername: item.contact.peerUsername,
                    peerEmail: item.contact.peerEmail,
                  })}
                  trailing={<Text className="text-xs font-medium text-muted">Open chat</Text>}
                />
              );
            }

            return (
              <ContactRow
                title={item.user.username}
                subtitle={item.user.email}
                avatarSeed={item.user.username}
                onPress={() =>
                  onOpenChat({
                    peerUserId: item.user.userId,
                    peerUsername: item.user.username,
                  })
                }
                badges={
                  <>
                    {item.verified ? <SecurityBadge ready label="Verified" /> : null}
                    <SecurityBadge
                      ready={Boolean(item.user.hasPublicKey)}
                      label={item.user.hasPublicKey ? 'Ready for E2EE' : 'No public key yet'}
                    />
                  </>
                }
                action={renderVerifyAction({
                  peerUserId: item.user.userId,
                  peerUsername: item.user.username,
                  peerEmail: item.user.email,
                  verified: item.verified,
                })}
                topAction={renderSaveAction({
                  peerUserId: item.user.userId,
                  peerUsername: item.user.username,
                  peerEmail: item.user.email,
                })}
                trailing={<Text className="text-xs font-medium text-muted">Open chat</Text>}
              />
            );
          }}
        />
      )}
    </View>
  );
}
