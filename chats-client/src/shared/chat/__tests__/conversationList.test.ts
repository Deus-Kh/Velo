import { buildHomeListItems, buildSearchResultItems, formatConversationTime, sortConversations } from '../conversationList';
import type { ConversationListItem } from '../../api/conversations.api';
import type { GroupView } from '../../api/groups.api';
import type { UserListItem } from '../../api/user.api';
import type { SearchHit } from '../../storage/messageStore';

/**
 * C1 — the chat list's ordering and sections, moved out of ChatListScreen unchanged.
 */
const conv = (id: string, lastMessageAt: number, peerUsername = id): ConversationListItem =>
  ({ conversationId: id, peerUserId: `u-${id}`, peerUsername, lastMessageAt, unreadCount: 0, peerHasPublicKey: true }) as ConversationListItem;
const group = (id: string, lastMessageAt: number): GroupView => ({ groupId: id, name: `G ${id}`, lastMessageAt, members: [] }) as unknown as GroupView;

describe('sortConversations', () => {
  it('puts pinned chats first, newest activity first within each half', () => {
    const items = [conv('a', 1), conv('b', 3), conv('c', 2)];
    expect(sortConversations(items, ['a']).map((c) => c.conversationId)).toEqual(['a', 'b', 'c']);
    expect(sortConversations(items, []).map((c) => c.conversationId)).toEqual(['b', 'c', 'a']);
  });
});

describe('buildHomeListItems', () => {
  it('sections groups, pinned and the rest, naming the last section by whether pins exist', () => {
    const pinned = conv('p', 5);
    const regular = conv('r', 4);
    const withPins = buildHomeListItems({ groups: [group('g1', 1), group('g2', 2)], activeConversations: [pinned, regular], pinnedConversationIds: ['p'] });
    expect(withPins.map((i) => (i.type === 'section' ? `#${i.label}` : i.id))).toEqual(['#Groups', 'group-g2', 'group-g1', '#Pinned', 'conversation-p', '#All Chats', 'conversation-r']);
    const noPins = buildHomeListItems({ groups: [], activeConversations: [regular], pinnedConversationIds: [] });
    expect(noPins.map((i) => (i.type === 'section' ? `#${i.label}` : i.id))).toEqual(['#Chats', 'conversation-r']);
  });
});

describe('buildSearchResultItems', () => {
  it('lists existing chats, then new contacts, then message hits with a resolved title', () => {
    const existing = conv('e', 1, 'erin');
    const user = { userId: 'u-new', username: 'newbie', hasPublicKey: true } as UserListItem;
    const hits: SearchHit[] = [
      { peerKey: 'u-e', message: { id: 'm1', createdAt: 1 } as SearchHit['message'], snippet: 'hello' },
      { peerKey: 'group:g1', message: { id: 'm2', createdAt: 2 } as SearchHit['message'], snippet: 'hi' },
      { peerKey: 'u-unknown', message: { id: 'm3', createdAt: 3 } as SearchHit['message'], snippet: 'yo' },
    ];
    const items = buildSearchResultItems({
      matchingConversations: [existing],
      matchingSearchContacts: [user],
      messageHits: hits,
      groups: [group('g1', 1)],
      profiles: { 'u-e': { name: 'Erin Shared' } },
      sortedConversations: [existing],
    });
    expect(items.map((i) => (i.type === 'section' ? `#${i.label}` : i.type === 'message' ? `${i.id}:${i.title}` : i.id))).toEqual([
      '#Existing Chats',
      'conversation-e',
      '#New Contacts',
      'user-u-new',
      '#Messages',
      'message-u-e-m1:Erin Shared',
      'message-group:g1-m2:G g1',
      'message-u-unknown-m3:u-unknown',
    ]);
    expect(buildSearchResultItems({ matchingConversations: [], matchingSearchContacts: [user], messageHits: [], groups: [], profiles: {}, sortedConversations: [] })[0]).toEqual({ type: 'section', id: 'section-new-contacts', label: 'Contacts' });
  });
});

describe('formatConversationTime', () => {
  it('shows the time for today and the date otherwise', () => {
    const now = new Date(2026, 9, 3, 15, 0);
    const today = new Date(2026, 9, 3, 8, 5).getTime();
    const older = new Date(2026, 8, 1).getTime();
    expect(formatConversationTime(today, now)).toBe(new Date(today).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    expect(formatConversationTime(older, now)).toBe(new Date(older).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  });
});
