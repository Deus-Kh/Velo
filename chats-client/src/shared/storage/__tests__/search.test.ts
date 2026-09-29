import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchStoredMessages, upsertStoredMessage, type StoredMessage } from '../messageStore';

/**
 * T7.8 — local search over the sealed store: a linear scan of the newest
 * records per conversation, case-insensitive, tombstones and system lines
 * excluded, scoped to one conversation or the whole account.
 */
const ME = 'me';
const msg = (peer: string, id: string, text: string, createdAt: number, over: Partial<StoredMessage> = {}): Promise<void> =>
  upsertStoredMessage({ myUserId: ME, peerUserId: peer, message: { id, clientMessageId: id, serverMessageId: null, direction: 'in', text, createdAt, seq: null, status: 'sent', deliveredAt: null, readAt: null, replyTo: null, expiresAt: null, ...over } });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('T7.8 local search', () => {
  it('finds matches across conversations, newest first, case-insensitively, with a snippet around the match', async () => {
    await msg('alice', 'a1', 'Let us meet at the Harbour cafe', 1000);
    await msg('alice', 'a2', 'nothing here', 2000);
    await msg('bob', 'b1', 'harbour tomorrow?', 3000);
    await msg('group:g1', 'g1', 'The HARBOUR plan is on', 4000, { senderUserId: 'carol' });
    await msg('alice', 'a3', 'deleted mention of harbour', 5000, { deletedAt: 5001, text: '' });
    await msg('alice', 'a4', 'You set messages to disappear after harbour', 6000, { system: true });
    await upsertStoredMessage({ myUserId: 'other', peerUserId: 'alice', message: { id: 'o1', clientMessageId: 'o1', serverMessageId: null, direction: 'in', text: 'harbour of another account', createdAt: 7000, seq: null, status: 'sent', deliveredAt: null, readAt: null, replyTo: null, expiresAt: null } });

    const hits = await searchStoredMessages({ myUserId: ME, query: 'harbour' });
    expect(hits.map((h) => [h.peerKey, h.message.id])).toEqual([
      ['group:g1', 'g1'],
      ['bob', 'b1'],
      ['alice', 'a1'],
    ]);
    expect(hits[2]!.snippet).toContain('Harbour cafe');
    expect(await searchStoredMessages({ myUserId: ME, query: 'HARBOUR', peerUserId: 'alice' })).toHaveLength(1);
    expect(await searchStoredMessages({ myUserId: ME, query: 'nowhere' })).toEqual([]);
    expect(await searchStoredMessages({ myUserId: ME, query: ' ' })).toEqual([]);
  });

  it('is bounded: the newest records per conversation and a result cap', async () => {
    for (let i = 0; i < 30; i += 1) await msg('alice', 'a' + String(i), 'needle ' + String(i), 1000 + i);
    const capped = await searchStoredMessages({ myUserId: ME, query: 'needle', maxResults: 5 });
    expect(capped).toHaveLength(5);
    expect(capped[0]!.message.id).toBe('a29');
    const windowed = await searchStoredMessages({ myUserId: ME, query: 'needle', perConversation: 10, maxResults: 100 });
    expect(windowed.map((h) => h.message.id)).toEqual(['a29', 'a28', 'a27', 'a26', 'a25', 'a24', 'a23', 'a22', 'a21', 'a20']);
  });
});
