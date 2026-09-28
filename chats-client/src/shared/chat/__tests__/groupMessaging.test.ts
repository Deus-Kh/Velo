import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSenderKeyState, groupEncrypt, senderKeyDistributionMessage, type SenderKeyState } from '@velo/protocol';
import type { GroupView } from '../../api/groups.api';
import type { HistoryItem } from '../../api/messages.api';
import { listStoredMessages } from '../../storage/messageStore';
import { loadOwnSenderKey, loadPeerSenderKey } from '../../storage/senderKeyStore';
import { handleControlContent, resetSenderKeyRequests } from '../groupKeys';
import { ingestGroupItems, sendGroupMessage } from '../groupMessaging';

/**
 * T6.4/T6.5: the device's group receive and send paths against a scripted
 * server. Sender keys are real (the protocol package); the socket, the
 * messages API and the pairwise control channel are recorded.
 */
const mockSent: Array<{ to: string; content: any }> = [];
const mockAcked: string[][] = [];
const mockEmitted: Array<{ event: string; dto: any }> = [];
let mockGroupSendAck: any = { ok: true, serverMessageId: 'srv-1', seq: 1, epoch: 1 };

jest.mock('../../socket/messaging', () => ({
  sendContent: jest.fn(async (to: string, content: unknown) => {
    mockSent.push({ to, content });
    return { serverMessageId: 'ctl' };
  }),
  subscribeToControlContent: jest.fn(() => () => {}),
}));
jest.mock('../../api/messages.api', () => ({
  messagesApi: {
    ackDelivered: jest.fn(async (ids: string[]) => {
      mockAcked.push(ids);
      return { data: { ok: true } };
    }),
    getUndelivered: jest.fn(async () => ({ data: { items: [] } })),
  },
}));
jest.mock('../../socket/socket', () => ({
  ensureSocketConnected: jest.fn(async () => ({
    emit: (event: string, dto: any, cb: (ack: any) => void) => {
      mockEmitted.push({ event, dto });
      cb(mockGroupSendAck);
    },
  })),
}));
jest.mock('../../api/telemetry.api', () => ({ reportDecryptFailure: jest.fn() }));

const ME = 'me';
const G = 'g1';
const group = (epoch: number, members: string[]): GroupView => ({
  groupId: G,
  name: 'trio',
  epoch,
  createdBy: 'alice',
  members: members.map((userId) => ({ userId, username: userId, role: 'member' as const, addedAt: 1 })),
  lastMessageAt: 0,
  lastSeq: 0,
  history: [],
});

let seq = 0;
function copyFrom(state: SenderKeyState, from: string, text: string): { item: HistoryItem; state: SenderKeyState } {
  const step = groupEncrypt(state, text, { groupId: G, senderUserId: from });
  seq += 1;
  return {
    state: step.state,
    item: { serverMessageId: 'srv-' + String(seq), fromUserId: from, toUserId: ME, groupId: G, g1: step.message, epoch: 1, clientMessageId: from + '-' + String(seq), createdAt: 1000 + seq, seq },
  };
}

async function giveKey(from: string, state: SenderKeyState, members: string[]) {
  await handleControlContent({ myUserId: ME, fromUserId: from, content: { v: 1, kind: 'skdm', groupId: G, skdm: senderKeyDistributionMessage(state) }, loadGroup: async () => group(1, members) });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSent.length = 0;
  mockAcked.length = 0;
  mockEmitted.length = 0;
  resetSenderKeyRequests();
  mockGroupSendAck = { ok: true, serverMessageId: 'srv-1', seq: 1, epoch: 1 };
});

describe('T6.4 group receive path', () => {
  it('opens copies under the stored member key, stores them with the sender, and acks them', async () => {
    let alice = createSenderKeyState();
    await giveKey('alice', alice, [ME, 'alice', 'bob']);
    const m1 = copyFrom(alice, 'alice', 'hi all');
    alice = m1.state;
    const m2 = copyFrom(alice, 'alice', 'second');
    const r = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m1.item, m2.item], memberIds: [ME, 'alice', 'bob'] });
    expect(r.received.map((m) => m.text)).toEqual(['hi all', 'second']);
    expect(r.received.map((m) => m.senderUserId)).toEqual(['alice', 'alice']);
    expect(r.waitingForKey).toEqual([]);
    expect(mockAcked).toEqual([[m1.item.serverMessageId, m2.item.serverMessageId]]);
    const stored = await listStoredMessages({ myUserId: ME, peerUserId: 'group:' + G, limit: 10 });
    expect(stored.map((m) => [m.text, m.direction, m.seq])).toEqual([
      ['hi all', 'in', 1],
      ['second', 'in', 2],
    ]);
    expect((await loadPeerSenderKey(ME, G, 'alice'))!.iteration).toBe(2); // the receiver state advanced
  });

  it('a copy from a member whose key is missing is left on the server and the key is requested once', async () => {
    const bob = createSenderKeyState();
    const m = copyFrom(bob, 'bob', 'you cannot read this yet');
    const r1 = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice', 'bob'] });
    expect(r1.received).toEqual([]);
    expect(r1.waitingForKey).toEqual(['bob']);
    expect(mockAcked).toEqual([]);
    expect(mockSent).toEqual([{ to: 'bob', content: { v: 1, kind: 'skdm-request', groupId: G } }]);

    // Same copy again before the key arrives: no second request within the interval.
    await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice', 'bob'] });
    expect(mockSent).toHaveLength(1);

    // bob's distribution arrives over the pairwise session: the next sync opens the copy.
    await giveKey('bob', bob, [ME, 'alice', 'bob']);
    const r2 = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice', 'bob'] });
    expect(r2.received.map((x) => x.text)).toEqual(['you cannot read this yet']);
    expect(mockAcked).toEqual([[m.item.serverMessageId]]);
  });

  it('T6.5: after a member rotates, its old-key copy is stale: not acked, key requested, then opened with the new key', async () => {
    const aliceOld = createSenderKeyState();
    await giveKey('alice', aliceOld, [ME, 'alice']);
    const aliceNew = createSenderKeyState(); // rotation: fresh keyId
    const m = copyFrom(aliceNew, 'alice', 'after rotation');
    const r1 = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice'] });
    expect(r1.received).toEqual([]);
    expect(r1.waitingForKey).toEqual(['alice']);
    expect(mockSent.map((s) => s.content.kind)).toEqual(['skdm-request']);
    expect(mockAcked).toEqual([]);

    await giveKey('alice', aliceNew, [ME, 'alice']);
    const r2 = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice'] });
    expect(r2.received.map((x) => x.text)).toEqual(['after rotation']);
  });

  it('T6.5: a copy from someone who is no longer a member is dropped and no key is requested from them', async () => {
    const mallory = createSenderKeyState();
    const m = copyFrom(mallory, 'mallory', 'still here?');
    const r = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice'] });
    expect(r.received).toEqual([]);
    expect(r.waitingForKey).toEqual([]);
    expect(r.dropped).toEqual([m.item.serverMessageId]);
    expect(mockSent).toEqual([]);
    expect(mockAcked).toEqual([[m.item.serverMessageId]]); // the copy does not linger on the server
    expect(await listStoredMessages({ myUserId: ME, peerUserId: 'group:' + G, limit: 10 })).toEqual([]);
  });

  it('a forged copy (wrong signing key) is refused, reported as a security warning, and not acked', async () => {
    const alice = createSenderKeyState();
    await giveKey('alice', alice, [ME, 'alice']);
    const impostor = createSenderKeyState({ keyId: alice.keyId, chainKey: new Uint8Array(32) });
    const m = copyFrom(impostor, 'alice', 'forged');
    const warnings: string[] = [];
    const r = await ingestGroupItems({ myUserId: ME, groupId: G, items: [m.item], memberIds: [ME, 'alice'], onSecurityWarning: (code) => warnings.push(code) });
    expect(r.received).toEqual([]);
    expect(r.failed.map((f) => f.code)).toEqual(['SENDER_KEY_SIGNATURE_INVALID']);
    expect(warnings).toEqual(['SENDER_KEY_SIGNATURE_INVALID']);
    expect(mockAcked).toEqual([]);
  });
});

describe('T6.4 group send path', () => {
  it('distributes our key to members who lack it, encrypts under it, emits group:send, stores the message', async () => {
    const g = group(1, [ME, 'alice', 'bob']);
    const r = await sendGroupMessage({ myUserId: ME, group: g, text: 'hello group', clientMessageId: 'c1', createdAt: 5000 });
    expect(mockSent.map((s) => [s.to, s.content.kind])).toEqual([
      ['alice', 'skdm'],
      ['bob', 'skdm'],
    ]);
    expect(mockEmitted).toHaveLength(1);
    expect(mockEmitted[0]!.event).toBe('group:send');
    expect(mockEmitted[0]!.dto.groupId).toBe(G);
    expect(mockEmitted[0]!.dto.epoch).toBe(1);
    expect(mockEmitted[0]!.dto.g1.v).toBe(1);
    expect(mockEmitted[0]!.dto.g1.iteration).toBe(0);
    expect(r.stored.status).toBe('sent');
    expect(r.stored.seq).toBe(1);
    expect((await loadOwnSenderKey(ME, G))!.state.iteration).toBe(1);

    // A second send distributes nothing more: everyone has the key.
    mockGroupSendAck = { ok: true, serverMessageId: 'srv-2', seq: 2, epoch: 1 };
    await sendGroupMessage({ myUserId: ME, group: g, text: 'again', clientMessageId: 'c2', createdAt: 5001 });
    expect(mockSent).toHaveLength(2);
    expect(mockEmitted[1]!.dto.g1.iteration).toBe(1);
    expect(mockEmitted[1]!.dto.g1.keyId).toBe(mockEmitted[0]!.dto.g1.keyId);
  });

  it('T6.5: a new epoch rotates the key (fresh keyId) and redistributes to every member', async () => {
    await sendGroupMessage({ myUserId: ME, group: group(1, [ME, 'alice', 'bob']), text: 'epoch 1', clientMessageId: 'c1', createdAt: 5000 });
    const keyIdEpoch1 = mockEmitted[0]!.dto.g1.keyId;
    mockSent.length = 0;
    // bob was removed: epoch 2, members me+alice.
    mockGroupSendAck = { ok: true, serverMessageId: 'srv-2', seq: 2, epoch: 2 };
    await sendGroupMessage({ myUserId: ME, group: group(2, [ME, 'alice']), text: 'epoch 2', clientMessageId: 'c2', createdAt: 5001 });
    expect(mockSent.map((s) => [s.to, s.content.kind])).toEqual([['alice', 'skdm']]); // bob gets nothing
    expect(mockEmitted[1]!.dto.g1.keyId).not.toBe(keyIdEpoch1);
    expect(mockEmitted[1]!.dto.g1.iteration).toBe(0);
    expect(mockEmitted[1]!.dto.epoch).toBe(2);
    expect(mockSent[0]!.content.skdm.keyId).toBe(mockEmitted[1]!.dto.g1.keyId);
  });

  it('a refused send (stale epoch) is stored as failed', async () => {
    mockGroupSendAck = { ok: false, code: 'STALE_EPOCH', epoch: 3 };
    const r = await sendGroupMessage({ myUserId: ME, group: group(2, [ME, 'alice']), text: 'late', clientMessageId: 'c9', createdAt: 5000 });
    expect(r.ack.ok).toBe(false);
    expect(r.stored.status).toBe('failed');
  });
});
