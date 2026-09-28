import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp, tokenFor } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';
import * as realtime from '../src/lib/realtime';

vi.mock('../src/push/firebase', () => ({ sendMessagePushToUser: vi.fn(async () => undefined) }));

/**
 * T6.3 — groups on the server: membership with roles and epochs, system
 * feed, realtime change notices, and group:send fan-out stored once per
 * recipient so delete-on-delivery and the undelivered listing work as for 1:1.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let sockets: Awaited<ReturnType<typeof startTestSocketServer>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let C: Awaited<ReturnType<typeof createUser>>;
let D: Awaited<ReturnType<typeof createUser>>;
let sa: Socket;
let sb: Socket;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const g1 = (iteration: number) => ({ v: 1 as const, keyId: 7, iteration, ciphertext: 'C'.repeat(64), signature: Buffer.alloc(64, 1).toString('base64') });

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B, C, D] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
  [sa, sb] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token)]);
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
  vi.restoreAllMocks();
});

async function createGroup(by = A, members = [B.userId, C.userId], name = 'trio') {
  const res = await request(harness.app).post('/groups').set(auth(by.token)).send({ name, memberIds: members });
  expect(res.status).toBe(201);
  return res.body as { groupId: string; epoch: number; members: Array<{ userId: string; role: string; username: string | null }>; history: Array<{ type: string }> };
}

describe('T6.3 groups', () => {
  it('create: the creator is admin, members get usernames, epoch 1, a created event; non-members cannot read it', async () => {
    const emit = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});
    const g = await createGroup();
    expect(g.epoch).toBe(1);
    expect(g.members.map((m) => [m.userId, m.role])).toEqual([[A.userId, 'admin'], [B.userId, 'member'], [C.userId, 'member']]);
    expect(g.members.every((m) => typeof m.username === 'string')).toBe(true);
    expect(g.history.map((e) => e.type)).toEqual(['created']);
    expect(emit.mock.calls.filter((c) => c[1] === 'group:changed').map((c) => c[0]).sort()).toEqual([A.userId, B.userId, C.userId].sort());

    expect((await request(harness.app).get(`/groups/${g.groupId}`).set(auth(D.token))).status).toBe(403);
    expect((await request(harness.app).get(`/groups/${g.groupId}`).set(auth(B.token))).status).toBe(200);
    const mine = await request(harness.app).get('/groups').set(auth(B.token));
    expect(mine.body.items.some((x: { groupId: string }) => x.groupId === g.groupId)).toBe(true);
    expect((await request(harness.app).post('/groups').set(auth(A.token)).send({ name: 'x', memberIds: ['65f0000000000000000000ff'] })).status).toBe(400);
  });

  it('membership: admins add and remove (epoch increments, everyone told, the removed one too); members cannot; leave promotes the oldest', async () => {
    const emit = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});
    const g = await createGroup();
    expect((await request(harness.app).post(`/groups/${g.groupId}/members`).set(auth(B.token)).send({ userIds: [D.userId] })).status).toBe(403);
    const added = await request(harness.app).post(`/groups/${g.groupId}/members`).set(auth(A.token)).send({ userIds: [D.userId] });
    expect(added.status).toBe(200);
    expect(added.body.epoch).toBe(2);
    expect(added.body.members).toHaveLength(4);

    emit.mockClear();
    const removed = await request(harness.app).delete(`/groups/${g.groupId}/members/${C.userId}`).set(auth(A.token));
    expect(removed.status).toBe(200);
    expect(removed.body.epoch).toBe(3);
    expect(removed.body.members.map((m: { userId: string }) => m.userId)).toEqual([A.userId, B.userId, D.userId]);
    const told = emit.mock.calls.filter((c) => c[1] === 'group:changed').map((c) => c[0]).sort();
    expect(told).toEqual([A.userId, B.userId, C.userId, D.userId].sort()); // the removed member learns it too
    expect((emit.mock.calls.find((c) => c[1] === 'group:changed')![2] as { change: { type: string } }).change.type).toBe('removed');

    // The only admin leaves: the longest-standing member is promoted.
    const left = await request(harness.app).post(`/groups/${g.groupId}/leave`).set(auth(A.token));
    expect(left.status).toBe(200);
    const after = await request(harness.app).get(`/groups/${g.groupId}`).set(auth(B.token));
    expect(after.body.epoch).toBe(4);
    expect(after.body.members.find((m: { userId: string }) => m.userId === B.userId).role).toBe('admin');
    expect(after.body.history.map((e: { type: string }) => e.type)).toEqual(['created', 'added', 'removed', 'left', 'promoted']);
    expect((await request(harness.app).get(`/groups/${g.groupId}`).set(auth(A.token))).status).toBe(403);
  });

  it('group:send fans out one copy per recipient with one seq; non-members and stale epochs are refused; delivery deletes one copy', async () => {
    const g = await createGroup(A, [B.userId, C.userId]);
    const toB = nextEvent<{ groupId: string; seq: number; g1: { iteration: number }; toUserId: string; epoch: number }>(sb, 'message:new', 2000);
    const ack = await emitAck<{ ok: boolean; seq: number; recipients: number; epoch: number }>(sa, 'group:send', {
      groupId: g.groupId, clientMessageId: 'grp-1', createdAt: Date.now(), epoch: 1, g1: g1(0),
    });
    expect(ack).toMatchObject({ ok: true, seq: 1, recipients: 2, epoch: 1 });
    const bGot = await toB;
    expect(bGot).toMatchObject({ groupId: g.groupId, seq: 1, epoch: 1, toUserId: B.userId });
    expect(bGot.g1.iteration).toBe(0);

    // C is offline: its copy waits in the undelivered listing for the group, with the same seq.
    const forC = await request(harness.app).get(`/messages/undelivered?groupId=${g.groupId}`).set(auth(C.token));
    expect(forC.body.items).toHaveLength(1);
    expect(forC.body.items[0]).toMatchObject({ groupId: g.groupId, seq: 1, fromUserId: A.userId, epoch: 1 });
    expect(forC.body.items[0].g1.signature).toBe(g1(0).signature);
    expect(forC.body.items[0].v4).toBeNull();
    const { sendMessagePushToUser } = await import('../src/push/firebase');
    expect(sendMessagePushToUser).toHaveBeenCalledWith(expect.objectContaining({ toUserId: C.userId }));

    // A resend returns the same seq; a non-member and a stale epoch are refused.
    const again = await emitAck<{ ok: boolean; seq: number }>(sa, 'group:send', { groupId: g.groupId, clientMessageId: 'grp-1', createdAt: Date.now(), g1: g1(0) });
    expect(again).toMatchObject({ ok: true, seq: 1 });
    const sd = await sockets.connect(D.token);
    const stranger = await emitAck<{ ok: boolean; code: string }>(sd, 'group:send', { groupId: g.groupId, clientMessageId: 'grp-x', createdAt: Date.now(), g1: g1(0) });
    expect(stranger).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const stale = await emitAck<{ ok: boolean; code: string; epoch: number }>(sa, 'group:send', { groupId: g.groupId, clientMessageId: 'grp-2', createdAt: Date.now(), epoch: 99, g1: g1(1) });
    expect(stale).toMatchObject({ ok: false, code: 'STALE_EPOCH', epoch: 1 });

    // B acks its copy: only B's copy loses its ciphertext; C's waits.
    const bAck = await emitAck<{ ok: boolean; status: string }>(sb, 'message:delivered', { serverMessageId: bGot.serverMessageId });
    expect(bAck).toMatchObject({ ok: true, status: 'delivered' });
    const forB = await request(harness.app).get(`/messages/undelivered?groupId=${g.groupId}`).set(auth(B.token));
    expect(forB.body.items).toEqual([]);
    expect((await request(harness.app).get(`/messages/undelivered?groupId=${g.groupId}`).set(auth(C.token))).body.items).toHaveLength(1);
    expect((await request(harness.app).get(`/messages/undelivered?groupId=${g.groupId}`).set(auth(D.token))).body.items).toEqual([]);
  });
});
