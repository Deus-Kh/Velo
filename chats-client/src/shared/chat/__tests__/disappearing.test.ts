import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GroupView } from '../../api/groups.api';
import { loadConversationSettings } from '../../storage/conversationSettingsStore';
import { findStoredMessage, listStoredMessages, upsertStoredMessage, type StoredMessage } from '../../storage/messageStore';
import { handleInboundAction, subscribeToMessagePatches } from '../actions';
import { applyTimer, formatTimer, handleInboundTimer, setDisappearingTimer, subscribeToTimerChanges, sweepExpiredMessages, timerSystemText } from '../disappearing';

/**
 * T7.3 — the timer as a conversation setting, expiry fixed when a record
 * is first stored, and the sweeper.
 */
const mockSent: Array<{ to: string; content: any }> = [];
const mockGroupSends: any[] = [];
const mockCancelled: string[] = [];
jest.mock('../../socket/messaging', () => ({
  sendContent: jest.fn(async (to: string, content: unknown) => {
    mockSent.push({ to, content });
    return { serverMessageId: 'ctl' };
  }),
  sendMessageV2: jest.fn(),
}));
jest.mock('../../crypto/sessionBootstrap', () => ({ ensureV2Session: jest.fn(async () => ({ initPacket: null })) }));
jest.mock('../groupMessaging', () => ({
  sendGroupContent: jest.fn(async (params: unknown) => {
    mockGroupSends.push(params);
    return { ok: true, serverMessageId: 'g-srv', seq: 1, epoch: 1 };
  }),
  sendGroupMessage: jest.fn(),
}));
jest.mock('../../notifications/notifee', () => ({
  cancelConversationNotifications: jest.fn(async (id: string) => {
    mockCancelled.push(id);
  }),
}));

const ME = 'me';
const PEER = 'alice';
const msg = (over: Partial<StoredMessage>): StoredMessage => ({ id: 'c1', clientMessageId: 'c1', serverMessageId: 's1', direction: 'in', text: 'hello', createdAt: 1000, seq: 1, status: 'sent', deliveredAt: null, readAt: null, replyTo: null, ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSent.length = 0;
  mockGroupSends.length = 0;
  mockCancelled.length = 0;
});

describe('T7.3 the timer as a conversation setting', () => {
  it('an inbound timer from the peer is saved, announced, and written as a system line that never expires', async () => {
    const events: Array<number | null> = [];
    const unsub = subscribeToTimerChanges((e) => events.push(e.settings.timerSeconds));
    const ok = await handleInboundTimer({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'timer', seconds: 3600 } });
    unsub();
    expect(ok).toBe(true);
    expect(events).toEqual([3600]);
    expect(await loadConversationSettings(ME, PEER)).toMatchObject({ timerSeconds: 3600, timerSetBy: PEER });
    const lines = await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 });
    expect(lines.map((l) => [l.system, l.text, l.expiresAt])).toEqual([[true, 'alice set messages to disappear after 1 hour', null]]);
    // The sealed record holds no plaintext.
    const raw = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('convset:v1:me:'));
    expect(raw).toHaveLength(1);
    expect(await AsyncStorage.getItem(raw[0]!)).not.toContain('3600');
    // Off is a system line too; the same value again is not repeated.
    await handleInboundAction({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'timer', seconds: null } });
    await handleInboundAction({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'timer', seconds: null } });
    expect((await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 })).map((l) => l.text)).toEqual(['alice set messages to disappear after 1 hour', 'alice turned disappearing messages off']);
    expect(timerSystemText({ setBy: ME, myUserId: ME, seconds: 86_400 })).toBe('You set messages to disappear after 1 day');
    expect([formatTimer(null), formatTimer(604_800), formatTimer(7_200), formatTimer(90)]).toEqual(['off', '1 week', '2 hours', '90 seconds']);
  });

  it('in a group only an admin may set the timer; unknown admins refuse', async () => {
    const gk = 'group:g1';
    expect(await handleInboundTimer({ myUserId: ME, peerKey: gk, actorUserId: 'bob', content: { v: 1, kind: 'timer', seconds: 60 }, groupAdminIds: ['carol'] })).toBe(false);
    expect(await handleInboundTimer({ myUserId: ME, peerKey: gk, actorUserId: 'bob', content: { v: 1, kind: 'timer', seconds: 60 }, groupAdminIds: null })).toBe(false);
    expect((await loadConversationSettings(ME, gk)).timerSeconds).toBeNull();
    expect(await handleInboundTimer({ myUserId: ME, peerKey: gk, actorUserId: 'carol', content: { v: 1, kind: 'timer', seconds: 60 }, groupAdminIds: ['carol'] })).toBe(true);
    expect((await loadConversationSettings(ME, gk)).timerSeconds).toBe(60);
  });

  it('our own change is applied locally, then sent over the session or the group chain', async () => {
    await setDisappearingTimer({ myUserId: ME, target: { kind: 'peer', peerUserId: PEER }, seconds: 86_400 });
    expect(mockSent).toEqual([{ to: PEER, content: { v: 1, kind: 'timer', seconds: 86_400 } }]);
    expect((await loadConversationSettings(ME, PEER)).timerSetBy).toBe(ME);
    const group: GroupView = { groupId: 'g1', name: 'trio', epoch: 1, createdBy: ME, members: [], lastMessageAt: 0, lastSeq: 0, history: [] };
    await setDisappearingTimer({ myUserId: ME, target: { kind: 'group', group }, seconds: null });
    expect(mockGroupSends[0].content).toEqual({ v: 1, kind: 'timer', seconds: null });
  });
});

describe('T7.3 expiry and the sweeper', () => {
  it('a record first stored under a timer gets its expiry: send time for outgoing, store time for incoming; later updates keep it', async () => {
    await applyTimer({ myUserId: ME, peerKey: PEER, setBy: PEER, seconds: 100, now: 0 });
    const before = Date.now();
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'out1', clientMessageId: 'out1', direction: 'out', createdAt: 5_000 }) });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'in1', clientMessageId: 'in1', direction: 'in', createdAt: 5_000 }) });
    const out1 = (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'out1' }))!;
    const in1 = (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'in1' }))!;
    expect(out1.expiresAt).toBe(5_000 + 100_000);
    expect(in1.expiresAt).toBeGreaterThanOrEqual(before + 100_000);
    // A status update (no expiresAt on the incoming object) keeps the fixed expiry.
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'out1', clientMessageId: 'out1', direction: 'out', createdAt: 5_000, status: 'delivered' }) });
    expect((await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'out1' }))!.expiresAt).toBe(105_000);
    // Without a timer, nothing expires; a record stored before the timer was set is untouched by it.
    await applyTimer({ myUserId: ME, peerKey: PEER, setBy: PEER, seconds: null, now: 1 });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'out2', clientMessageId: 'out2', direction: 'out', createdAt: 6_000 }) });
    expect((await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'out2' }))!.expiresAt).toBeNull();
    expect((await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'out1' }))!.expiresAt).toBe(105_000);
  });

  it('the sweeper removes expired records across conversations, tells the UI, and cancels their notifications', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'a', clientMessageId: 'a', createdAt: 1_000, expiresAt: 2_000 }) });
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'b', clientMessageId: 'b', createdAt: 1_500, expiresAt: 9_999_999 }) });
    await upsertStoredMessage({ myUserId: ME, peerUserId: 'group:g1', message: msg({ id: 'c', clientMessageId: 'c', senderUserId: 'bob', createdAt: 1_000, expiresAt: 1_500 }) });
    await upsertStoredMessage({ myUserId: 'other', peerUserId: PEER, message: msg({ id: 'd', clientMessageId: 'd', createdAt: 1_000, expiresAt: 1 }) });
    const removed: string[] = [];
    const unsub = subscribeToMessagePatches((p) => {
      if (!p.message) removed.push(`${p.peerKey}/${p.id}`);
    });
    const r = await sweepExpiredMessages({ myUserId: ME, now: 3_000 });
    unsub();
    expect(r.removed).toBe(2);
    expect(r.conversations.sort()).toEqual(['alice', 'group:g1']);
    expect(removed.sort()).toEqual(['alice/a', 'group:g1/c']);
    expect((await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 })).map((m) => m.id)).toEqual(['b']);
    expect(await listStoredMessages({ myUserId: ME, peerUserId: 'group:g1', limit: 10 })).toEqual([]);
    expect((await listStoredMessages({ myUserId: 'other', peerUserId: PEER, limit: 10 })).map((m) => m.id)).toEqual(['d']); // another account's store is not ours
    expect(mockCancelled.sort()).toEqual(['alice:me', 'group:g1']);
    // A per-conversation sweep touches only that slot.
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'e', clientMessageId: 'e', createdAt: 1_600, expiresAt: 2_500 }) });
    await upsertStoredMessage({ myUserId: ME, peerUserId: 'bob', message: msg({ id: 'f', clientMessageId: 'f', createdAt: 1_600, expiresAt: 2_500 }) });
    expect((await sweepExpiredMessages({ myUserId: ME, peerKey: PEER, now: 3_000 })).removed).toBe(1);
    expect((await listStoredMessages({ myUserId: ME, peerUserId: 'bob', limit: 10 })).map((m) => m.id)).toEqual(['f']);
  });
});
