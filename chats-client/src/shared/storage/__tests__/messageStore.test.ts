import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {
  countStoredMessages,
  deleteStoredMessagesForPair,
  latestStoredCreatedAt,
  listStoredMessages,
  upsertStoredMessage,
  type StoredMessage,
} from '../messageStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keychain', () => {
  const store = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
      store.has(service) ? { service, username: 'u', password: store.get(service)! } : false,
    ),
    setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
      store.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }: { service: string }) => store.delete(service)),
    __store: store,
  };
});

const ME = '65f000000000000000000001';
const PEER = '65f000000000000000000002';

function msg(i: number, direction: 'in' | 'out' = 'in'): StoredMessage {
  return {
    id: 'c' + String(i),
    clientMessageId: 'c' + String(i),
    serverMessageId: null,
    direction,
    text: 'secret text ' + String(i),
    createdAt: 1_700_000_000_000 + i * 1000,
    status: 'sent',
    deliveredAt: null,
    readAt: null,
    replyTo: null,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
});

describe('messageStore (T2.14, sealed AsyncStorage)', () => {
  it('stores messages sealed: no plaintext on disk, round-trips, keeps time order', async () => {
    for (const i of [3, 1, 2]) await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg(i) });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith('msg:v1:'))).toHaveLength(3);
    for (const k of keys) {
      const raw = (await AsyncStorage.getItem(k)) ?? '';
      expect(raw).not.toContain('secret text');
    }
    const all = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 });
    expect(all.map((m) => m.id)).toEqual(['c1', 'c2', 'c3']);
    expect(all[0]!.text).toBe('secret text 1');
  });

  it('pages newest-first with a before cursor and reports the latest stored time', async () => {
    for (let i = 1; i <= 7; i += 1) await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg(i) });
    const page1 = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 3 });
    expect(page1.map((m) => m.id)).toEqual(['c5', 'c6', 'c7']);
    const page2 = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 3, before: page1[0]!.createdAt });
    expect(page2.map((m) => m.id)).toEqual(['c2', 'c3', 'c4']);
    const page3 = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 3, before: page2[0]!.createdAt });
    expect(page3.map((m) => m.id)).toEqual(['c1']);
    expect(await latestStoredCreatedAt({ myUserId: ME, peerUserId: PEER })).toBe(msg(7).createdAt);
    expect(await countStoredMessages({ myUserId: ME, peerUserId: PEER })).toBe(7);
  });

  it('upsert by id updates status in place; another user cannot open the records; deleting a pair leaves others', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg(1, 'out') });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: { ...msg(1, 'out'), status: 'delivered', serverMessageId: 'srv1' } });
    const all = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'delivered', serverMessageId: 'srv1' });

    // Records sealed under ME's master key are opaque under another user's key.
    const other = '65f000000000000000000009';
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.startsWith('msg:v1:'))!;
    const raw = (await AsyncStorage.getItem(key))!;
    await AsyncStorage.setItem(key.replace(ME, other), raw);
    expect(await listStoredMessages({ myUserId: other, peerUserId: PEER, limit: 10 })).toEqual([]);

    await upsertStoredMessage({ myUserId: ME, peerUserId: 'peer-b', message: msg(2) });
    await deleteStoredMessagesForPair({ myUserId: ME, peerUserId: PEER });
    expect(await countStoredMessages({ myUserId: ME, peerUserId: PEER })).toBe(0);
    expect(await countStoredMessages({ myUserId: ME, peerUserId: 'peer-b' })).toBe(1);
  });
});
