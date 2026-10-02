import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { deleteStoredMessage, latestStoredMessagesByPeer, patchStoredMessage, upsertStoredMessage, type StoredMessage } from '../messageStore';

/**
 * Roadmap §8.1 A1 — the newest stored record per conversation, read in one
 * pass over the sealed store: the source of the chat-list preview.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-keychain', () => {
  const store = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    getGenericPassword: jest.fn(async ({ service }: { service: string }) => (store.has(service) ? { service, username: 'u', password: store.get(service)! } : false)),
    setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
      store.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }: { service: string }) => store.delete(service)),
    __store: store,
  };
});

const ME = '65f000000000000000000001';
const PEER_A = '65f000000000000000000002';
const PEER_B = '65f000000000000000000003';
const GROUP = 'group:65f000000000000000000009';

function msg(i: number, text: string, direction: 'in' | 'out' = 'in'): StoredMessage {
  return { id: 'c' + i, clientMessageId: 'c' + i, serverMessageId: null, direction, text, createdAt: 1_700_000_000_000 + i * 1000, seq: i, status: 'sent', deliveredAt: null, readAt: null, replyTo: null };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
});

describe('latestStoredMessagesByPeer', () => {
  it('returns the newest record of every conversation of the user, groups included, other users excluded', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_A, message: msg(1, 'old') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_A, message: msg(3, 'newest a', 'out') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_A, message: msg(2, 'middle') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_B, message: msg(5, 'only b') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: GROUP, message: { ...msg(4, 'group line'), senderUserId: PEER_B } });
    await upsertStoredMessage({ myUserId: PEER_B, peerUserId: ME, message: msg(9, 'someone else') });

    const latest = await latestStoredMessagesByPeer(ME);
    expect(Object.keys(latest).sort()).toEqual([PEER_A, PEER_B, GROUP].sort());
    expect(latest[PEER_A]).toMatchObject({ id: 'c3', text: 'newest a', direction: 'out' });
    expect(latest[PEER_B]).toMatchObject({ id: 'c5', text: 'only b' });
    expect(latest[GROUP]).toMatchObject({ id: 'c4', text: 'group line', senderUserId: PEER_B });
    expect(await latestStoredMessagesByPeer('65f000000000000000000077')).toEqual({});
  });

  it('follows edits, tombstones and deletions of the newest record', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_A, message: msg(1, 'first') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER_A, message: msg(2, 'second') });
    await patchStoredMessage({ myUserId: ME, peerUserId: PEER_A, id: 'c2', createdAt: msg(2, '').createdAt, patch: { text: 'second (edited)', editedAt: 7 } });
    expect((await latestStoredMessagesByPeer(ME))[PEER_A]).toMatchObject({ text: 'second (edited)', editedAt: 7 });
    await patchStoredMessage({ myUserId: ME, peerUserId: PEER_A, id: 'c2', createdAt: msg(2, '').createdAt, patch: { text: '', deletedAt: 8 } });
    expect((await latestStoredMessagesByPeer(ME))[PEER_A]).toMatchObject({ id: 'c2', deletedAt: 8 });
    await deleteStoredMessage({ myUserId: ME, peerUserId: PEER_A, id: 'c2', createdAt: msg(2, '').createdAt });
    expect((await latestStoredMessagesByPeer(ME))[PEER_A]).toMatchObject({ id: 'c1', text: 'first' });
    await deleteStoredMessage({ myUserId: ME, peerUserId: PEER_A, id: 'c1', createdAt: msg(1, '').createdAt });
    expect(await latestStoredMessagesByPeer(ME)).toEqual({});
  });
});
