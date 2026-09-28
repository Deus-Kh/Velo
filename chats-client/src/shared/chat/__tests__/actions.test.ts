import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GroupView } from '../../api/groups.api';
import { findStoredMessage, listStoredMessages, upsertStoredMessage, type StoredMessage } from '../../storage/messageStore';
import { applyActionContent, deleteForEveryone, deleteForMe, editMessage, forwardMessage, handleInboundAction, reactToMessage, subscribeToMessagePatches, summarizeReactions } from '../actions';

/**
 * T7.2 — message actions on the sealed store: who may do what, and the
 * local-first send path over a recorded transport.
 */
const mockSent: Array<{ to: string; content: any }> = [];
const mockPairwise: Array<{ params: any }> = [];
const mockGroupSends: any[] = [];
jest.mock('../../socket/messaging', () => ({
  sendContent: jest.fn(async (to: string, content: unknown) => {
    mockSent.push({ to, content });
    return { serverMessageId: 'ctl' };
  }),
  sendMessageV2: jest.fn(async (params: unknown) => {
    mockPairwise.push({ params });
    return { serverMessageId: 'srv-fwd', seq: 9 };
  }),
}));
jest.mock('../../crypto/sessionBootstrap', () => ({ ensureV2Session: jest.fn(async () => ({ initPacket: null })) }));
jest.mock('../groupMessaging', () => ({
  sendGroupContent: jest.fn(async (params: unknown) => {
    mockGroupSends.push(params);
    return { ok: true, serverMessageId: 'g-srv', seq: 1, epoch: 1 };
  }),
  sendGroupMessage: jest.fn(async (params: any) => {
    mockGroupSends.push(params);
    const stored: StoredMessage = { id: params.clientMessageId, clientMessageId: params.clientMessageId, serverMessageId: 'g-srv', direction: 'out', senderUserId: params.myUserId, text: params.text, createdAt: params.createdAt, seq: 2, status: 'sent', deliveredAt: null, readAt: null, replyTo: null, forwardedFrom: params.forwardedFrom ?? null };
    return { stored, ack: { ok: true } };
  }),
}));

const ME = 'me';
const PEER = 'alice';
const msg = (over: Partial<StoredMessage>): StoredMessage => ({ id: 'c1', clientMessageId: 'c1', serverMessageId: 's1', direction: 'in', text: 'hello', createdAt: 1000, seq: 1, status: 'sent', deliveredAt: null, readAt: null, replyTo: null, ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSent.length = 0;
  mockPairwise.length = 0;
  mockGroupSends.length = 0;
});

describe('T7.2 applying actions', () => {
  it('a reaction from the peer is recorded per user, replaced on a second one, and withdrawn with remove', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ direction: 'out' }) });
    const target = { senderUserId: ME, clientMessageId: 'c1' };
    const patches: Array<string | null> = [];
    const unsub = subscribeToMessagePatches((p) => patches.push(p.message ? JSON.stringify(p.message.reactions) : null));
    let r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'reaction', target, emoji: '\u{1F44D}' } });
    expect(r.applied && r.message.reactions).toEqual({ alice: '\u{1F44D}' });
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'reaction', target, emoji: '❤' } });
    expect(r.applied && r.message.reactions).toEqual({ alice: '❤' });
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: ME, content: { v: 1, kind: 'reaction', target, emoji: '❤' } });
    expect(r.applied && r.message.reactions).toEqual({ alice: '❤', me: '❤' });
    expect(summarizeReactions(r.applied ? r.message.reactions : null, ME)).toEqual([{ emoji: '❤', count: 2, mine: true }]);
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'reaction', target, emoji: '❤', remove: true } });
    expect(r.applied && r.message.reactions).toEqual({ me: '❤' });
    unsub();
    expect(patches).toHaveLength(4);
    expect((await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c1' }))!.reactions).toEqual({ me: '❤' });
  });

  it('only the sender may edit or delete; a wrong target sender or an unknown target is ignored', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({}) }); // alice's message
    const target = { senderUserId: PEER, clientMessageId: 'c1' };
    // We are not the sender: refused, nothing changes.
    let r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: ME, content: { v: 1, kind: 'edit', target, text: 'hijack' } });
    expect(r).toEqual({ applied: false, reason: 'only the sender may edit or delete' });
    // A target that names the wrong sender: refused (the ref is checked against the record).
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'edit', target: { senderUserId: ME, clientMessageId: 'c1' }, text: 'x' } });
    expect(r.applied).toBe(false);
    // Unknown target: ignored.
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'delete', target: { senderUserId: PEER, clientMessageId: 'nope' } } });
    expect(r).toEqual({ applied: false, reason: 'target not stored on this device' });
    // The sender edits: applied with editedAt.
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'edit', target, text: 'corrected' }, now: 5000 });
    expect(r.applied && [r.message.text, r.message.editedAt]).toEqual(['corrected', 5000]);
    // The sender deletes: a tombstone with no text and no reactions; further edits and reactions are refused.
    await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: ME, content: { v: 1, kind: 'reaction', target, emoji: 'x' } });
    r = await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'delete', target }, now: 6000 });
    expect(r.applied && [r.message.text, r.message.deletedAt, r.message.reactions, r.message.editedAt]).toEqual(['', 6000, {}, null]);
    expect((await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'edit', target, text: 'again' } })).applied).toBe(false);
    expect((await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: ME, content: { v: 1, kind: 'reaction', target, emoji: 'x' } })).applied).toBe(false);
    // A timer is not a message action (T7.3 owns it); inbound handling never throws.
    expect((await applyActionContent({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'timer', seconds: 60 } })).applied).toBe(false);
    await expect(handleInboundAction({ myUserId: ME, peerKey: PEER, actorUserId: PEER, content: { v: 1, kind: 'text', text: 'x' } })).resolves.toBeUndefined();
  });

  it('group messages are attributed by senderUserId: a member may edit its own, not another member’s', async () => {
    const gk = 'group:g1';
    await upsertStoredMessage({ myUserId: ME, peerUserId: gk, message: msg({ senderUserId: 'bob' }) });
    const target = { senderUserId: 'bob', clientMessageId: 'c1' };
    expect((await applyActionContent({ myUserId: ME, peerKey: gk, actorUserId: 'carol', content: { v: 1, kind: 'delete', target } })).applied).toBe(false);
    expect((await applyActionContent({ myUserId: ME, peerKey: gk, actorUserId: 'carol', content: { v: 1, kind: 'reaction', target, emoji: 'x' } })).applied).toBe(true);
    expect((await applyActionContent({ myUserId: ME, peerKey: gk, actorUserId: 'bob', content: { v: 1, kind: 'delete', target } })).applied).toBe(true);
  });
});

describe('T7.2 sending actions and forwarding', () => {
  const group: GroupView = { groupId: 'g1', name: 'trio', epoch: 1, createdBy: ME, members: [], lastMessageAt: 0, lastSeq: 0, history: [] };

  it('our own action is applied locally, then sent over the pairwise session or the group chain', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ direction: 'out' }) });
    const stored = (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c1' }))!;
    const r = await reactToMessage({ myUserId: ME, target: { kind: 'peer', peerUserId: PEER }, message: stored, emoji: '\u{1F44D}' });
    expect(r.applied && r.message.reactions).toEqual({ me: '\u{1F44D}' });
    expect(mockSent).toEqual([{ to: PEER, content: { v: 1, kind: 'reaction', target: { senderUserId: ME, clientMessageId: 'c1' }, emoji: '\u{1F44D}' } }]);

    await editMessage({ myUserId: ME, target: { kind: 'peer', peerUserId: PEER }, message: stored, text: '  edited  ' });
    expect(mockSent[1]!.content).toEqual({ v: 1, kind: 'edit', target: { senderUserId: ME, clientMessageId: 'c1' }, text: 'edited' });
    expect((await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c1' }))!.text).toBe('edited');

    // Someone else's message cannot be edited or deleted for everyone from here: nothing is sent.
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ id: 'c2', clientMessageId: 'c2', createdAt: 2000 }) });
    const theirs = (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c2' }))!;
    expect((await deleteForEveryone({ myUserId: ME, target: { kind: 'peer', peerUserId: PEER }, message: theirs })).applied).toBe(false);
    expect(mockSent).toHaveLength(2);

    // In a group the action travels on the group chain.
    await upsertStoredMessage({ myUserId: ME, peerUserId: 'group:g1', message: msg({ direction: 'out', senderUserId: ME }) });
    const mine = (await findStoredMessage({ myUserId: ME, peerUserId: 'group:g1', id: 'c1' }))!;
    await deleteForEveryone({ myUserId: ME, target: { kind: 'group', group }, message: mine });
    expect(mockGroupSends).toHaveLength(1);
    expect(mockGroupSends[0].content).toEqual({ v: 1, kind: 'delete', target: { senderUserId: ME, clientMessageId: 'c1' } });
    expect((await findStoredMessage({ myUserId: ME, peerUserId: 'group:g1', id: 'c1' }))!.deletedAt).not.toBeNull();
  });

  it('delete for me removes the record here only and tells the UI', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({}) });
    const removed: Array<string | null> = [];
    const unsub = subscribeToMessagePatches((p) => removed.push(p.message ? 'patched' : p.id));
    await deleteForMe({ myUserId: ME, peerKey: PEER, message: (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c1' }))! });
    unsub();
    expect(removed).toEqual(['c1']);
    expect(await listStoredMessages({ myUserId: ME, peerUserId: PEER, limit: 10 })).toEqual([]);
    expect(mockSent).toEqual([]);
  });

  it('forwarding sends the text with its provenance and stores an outgoing copy in the target chat', async () => {
    await upsertStoredMessage({ myUserId: ME, peerUserId: PEER, message: msg({ createdAt: 1234 }) });
    const original = (await findStoredMessage({ myUserId: ME, peerUserId: PEER, id: 'c1' }))!;
    const stored = await forwardMessage({ myUserId: ME, fromPeerKey: PEER, message: original, to: { kind: 'peer', peerUserId: 'bob' } });
    expect(stored.forwardedFrom).toEqual({ userId: PEER, createdAt: 1234 });
    expect(stored.status).toBe('sent');
    expect(mockPairwise[0]!.params).toMatchObject({ toUserId: 'bob', plaintext: 'hello', forwardedFrom: { userId: PEER, createdAt: 1234 } });
    expect((await listStoredMessages({ myUserId: ME, peerUserId: 'bob', limit: 10 })).map((m) => [m.text, m.forwardedFrom?.userId])).toEqual([['hello', PEER]]);

    // Forwarding a forward keeps the original provenance; into a group it goes on the group chain.
    const twice = await forwardMessage({ myUserId: ME, fromPeerKey: 'bob', message: stored, to: { kind: 'group', group } });
    expect(twice.forwardedFrom).toEqual({ userId: PEER, createdAt: 1234 });
    expect(mockGroupSends.at(-1)).toMatchObject({ text: 'hello', forwardedFrom: { userId: PEER, createdAt: 1234 } });

    // A tombstone cannot be forwarded.
    await expect(forwardMessage({ myUserId: ME, fromPeerKey: PEER, message: { ...original, deletedAt: 1, text: '' }, to: { kind: 'peer', peerUserId: 'bob' } })).rejects.toThrow();
  });
});
