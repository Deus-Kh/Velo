import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { createSenderKeyState, senderKeyDistributionMessage } from '@velo/protocol';
import type { GroupView } from '../../api/groups.api';
import { deleteGroupKeys, loadDistribution, loadOwnSenderKey, loadPeerSenderKey, saveDistribution } from '../../storage/senderKeyStore';
import { ensureOwnSenderKey, forgetDepartedMembers, handleControlContent, membersLackingKey, ownKeyIsCurrent, requestSenderKey, resetSenderKeyRequests } from '../groupKeys';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
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
const sent: Array<{ to: string; content: unknown }> = [];
jest.mock('../../socket/messaging', () => ({
  sendContent: jest.fn(async (to: string, content: unknown) => {
    sent.push({ to, content });
  }),
  subscribeToControlContent: jest.fn(() => () => {}),
}));

const ME = 'me';
const group = (epoch: number, members: string[]): GroupView => ({
  groupId: 'g1',
  name: 'trio',
  epoch,
  createdBy: ME,
  members: members.map((userId) => ({ userId, username: userId, role: 'member' as const, addedAt: 1 })),
  lastMessageAt: 0,
  lastSeq: 0,
  history: [],
});

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
  sent.length = 0;
  resetSenderKeyRequests();
});

describe('T6.4 sender-key lifecycle on the device', () => {
  it('our key exists per epoch: created once, kept within the epoch, rotated when the epoch moves (T6.5)', async () => {
    const first = await ensureOwnSenderKey({ myUserId: ME, groupId: 'g1', epoch: 1 });
    expect(first.rotated).toBe(true);
    const again = await ensureOwnSenderKey({ myUserId: ME, groupId: 'g1', epoch: 1 });
    expect(again.rotated).toBe(false);
    expect(again.state.keyId).toBe(first.state.keyId);
    const rotated = await ensureOwnSenderKey({ myUserId: ME, groupId: 'g1', epoch: 2 });
    expect(rotated.rotated).toBe(true);
    expect(rotated.state.keyId).not.toBe(first.state.keyId);
    expect((await loadOwnSenderKey(ME, 'g1'))!.epoch).toBe(2);
    expect((await loadDistribution(ME, 'g1'))!.userIds).toEqual([]); // nobody has the new key yet
    // Sealed at rest: no chain key or signing secret in the clear.
    const raw = (await AsyncStorage.getItem('sk:v1:me:g1:own'))!;
    expect(raw).not.toContain(rotated.state.chainKey);
    expect(raw).not.toContain(rotated.state.signingPrivateKey!);
    expect(ownKeyIsCurrent(null, 1)).toBe(false);
  });

  it('members lacking the key are computed per epoch and keyId', () => {
    const g = group(3, [ME, 'a', 'b', 'c']);
    expect(membersLackingKey(g, ME, null, 9)).toEqual(['a', 'b', 'c']);
    expect(membersLackingKey(g, ME, { epoch: 3, keyId: 9, userIds: ['a', 'c'] }, 9)).toEqual(['b']);
    // a previous epoch counts for nothing
    expect(membersLackingKey(g, ME, { epoch: 2, keyId: 9, userIds: ['a', 'b', 'c'] }, 9)).toEqual(['a', 'b', 'c']);
    // a previous keyId counts for nothing
    expect(membersLackingKey(g, ME, { epoch: 3, keyId: 8, userIds: ['a', 'b', 'c'] }, 9)).toEqual(['a', 'b', 'c']);
  });

  it('a member’s key arrives as control content and is stored; a request is answered with our key to that member only', async () => {
    const alice = createSenderKeyState();
    const loadGroup = async () => group(1, [ME, 'alice', 'bob']);
    const stored = await handleControlContent({ myUserId: ME, fromUserId: 'alice', content: { v: 1, kind: 'skdm', groupId: 'g1', skdm: senderKeyDistributionMessage(alice) }, loadGroup });
    expect(stored).toEqual({ kind: 'stored-key', groupId: 'g1', fromUserId: 'alice' });
    const peer = await loadPeerSenderKey(ME, 'g1', 'alice');
    expect(peer?.keyId).toBe(alice.keyId);
    expect(peer?.signingPrivateKey).toBeUndefined();

    // A non-member's key is ignored.
    const ignored = await handleControlContent({ myUserId: ME, fromUserId: 'mallory', content: { v: 1, kind: 'skdm', groupId: 'g1', skdm: senderKeyDistributionMessage(alice) }, loadGroup });
    expect(ignored.kind).toBe('ignored');
    expect(await loadPeerSenderKey(ME, 'g1', 'mallory')).toBeNull();

    // bob asks for our key: we send it to bob and remember that bob has it.
    await saveDistribution(ME, 'g1', { epoch: 1, keyId: 0, userIds: [] });
    const answered = await handleControlContent({ myUserId: ME, fromUserId: 'bob', content: { v: 1, kind: 'skdm-request', groupId: 'g1' }, loadGroup });
    expect(answered.kind).toBe('answered-request');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('bob');
    expect((sent[0]!.content as { kind: string; skdm: { deviceId: number } }).kind).toBe('skdm');
    expect((sent[0]!.content as { skdm: { deviceId: number } }).skdm.deviceId).toBe(0);
    expect((await loadDistribution(ME, 'g1'))!.userIds).toEqual(['bob']);
  });

  it('a key request is rate-limited per member, and departed members’ keys are forgotten', async () => {
    expect(await requestSenderKey({ myUserId: ME, groupId: 'g1', fromUserId: 'alice', now: 1_000 })).toBe(true);
    expect(await requestSenderKey({ myUserId: ME, groupId: 'g1', fromUserId: 'alice', now: 2_000 })).toBe(false);
    expect(await requestSenderKey({ myUserId: ME, groupId: 'g1', fromUserId: 'alice', now: 40_000 })).toBe(true);
    expect(sent.filter((s) => (s.content as { kind: string }).kind === 'skdm-request')).toHaveLength(2);

    const alice = createSenderKeyState();
    await handleControlContent({ myUserId: ME, fromUserId: 'alice', content: { v: 1, kind: 'skdm', groupId: 'g1', skdm: senderKeyDistributionMessage(alice) }, loadGroup: async () => group(1, [ME, 'alice']) });
    const gone = await forgetDepartedMembers({ myUserId: ME, group: group(2, [ME]), previousMemberIds: [ME, 'alice'] });
    expect(gone).toEqual(['alice']);
    expect(await loadPeerSenderKey(ME, 'g1', 'alice')).toBeNull();

    await ensureOwnSenderKey({ myUserId: ME, groupId: 'g1', epoch: 2 });
    await deleteGroupKeys(ME, 'g1');
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.includes(':g1'))).toEqual([]);
  });
});
