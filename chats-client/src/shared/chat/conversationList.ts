import type { ConversationListItem } from '../api/conversations.api';
import type { GroupView } from '../api/groups.api';
import type { UserListItem } from '../api/user.api';
import type { SearchHit } from '../storage/messageStore';

/**
 * C1: the chat list's pure helpers: row time stamps, pinned-first order,
 * and the sectioned item lists of the home screen and of a search.
 */
export type HomeListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'conversation'; id: string; item: ConversationListItem }
  | { type: 'group'; id: string; group: GroupView };

export type SearchResultListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'conversation'; id: string; item: ConversationListItem }
  | { type: 'user'; id: string; item: UserListItem }
  | { type: 'message'; id: string; hit: SearchHit; title: string };

export function formatConversationTime(value: number, now: Date = new Date()): string {
  const date = new Date(value);
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

export function sortConversations(
  items: ConversationListItem[],
  pinnedConversationIds: string[],
): ConversationListItem[] {
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

/** Groups first (newest activity first), then pinned chats, then the rest. */
export function buildHomeListItems({
  groups,
  activeConversations,
  pinnedConversationIds,
}: {
  groups: GroupView[];
  activeConversations: ConversationListItem[];
  pinnedConversationIds: string[];
}): HomeListItem[] {
  const items: HomeListItem[] = [];
  if (groups.length > 0) {
    items.push({ type: 'section', id: 'section-groups', label: 'Groups' });
    [...groups]
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .forEach((group) => items.push({ type: 'group', id: `group-${group.groupId}`, group }));
  }
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
}

/** Existing chats that match, contacts from the directory, then messages found on this device (T7.8). */
export function buildSearchResultItems({
  matchingConversations,
  matchingSearchContacts,
  messageHits,
  groups,
  profiles,
  sortedConversations,
}: {
  matchingConversations: ConversationListItem[];
  matchingSearchContacts: UserListItem[];
  messageHits: SearchHit[];
  groups: GroupView[];
  profiles: Record<string, { name: string } | null | undefined>;
  sortedConversations: ConversationListItem[];
}): SearchResultListItem[] {
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

  if (messageHits.length > 0) {
    items.push({ type: 'section', id: 'section-messages', label: 'Messages' });
    for (const hit of messageHits) {
      const isGroup = hit.peerKey.startsWith('group:');
      const title = isGroup
        ? groups.find((g) => 'group:' + g.groupId === hit.peerKey)?.name ?? 'Group'
        : profiles[hit.peerKey]?.name?.trim() || sortedConversations.find((c) => c.peerUserId === hit.peerKey)?.peerUsername || hit.peerKey;
      items.push({ type: 'message', id: `message-${hit.peerKey}-${hit.message.id}`, hit, title });
    }
  }

  return items;
}
