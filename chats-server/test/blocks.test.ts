import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';
import { sendMessagePushToUser } from '../src/push/firebase';

vi.mock('../src/push/firebase', () => ({ sendMessagePushToUser: vi.fn(async () => undefined) }));

/**
 * T7.5 — block and report. A block is silent and symmetric in effect:
 * nothing is stored, delivered, pushed or shared between the pair; the
 * blocked side is never told. Reports carry only what the reporter wrote.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let sockets: Awaited<ReturnType<typeof startTestSocketServer>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let C: Awaited<ReturnType<typeof createUser>>;
let sa: Socket;
let sb: Socket;
let sc: Socket;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const encHeaderB64 = Buffer.alloc(85, 7).toString('base64');
const v4Payload = () => ({ encHeader: encHeaderB64, ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) });
const g1 = () => ({ v: 1 as const, keyId: 7, iteration: 0, ciphertext: 'C'.repeat(64), signature: Buffer.alloc(64, 1).toString('base64') });
let counter = 0;

async function send(from: Socket, toUserId: string) {
  counter += 1;
  return emitAck<{ ok: boolean; serverMessageId: string | null; seq: number | null; code?: string }>(from, 'message:send', {
    toUserId, clientMessageId: `cm-${counter}`, createdAt: Date.now(), protoVersion: 4, v4: v4Payload(),
  });
}

async function heldFor(userId: string, token: string): Promise<number> {
  const res = await request(harness.app).get('/messages/undelivered').set(auth(token));
  return (res.body.items as Array<{ toUserId: string }>).filter((i) => i.toUserId === userId).length;
}

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B, C] = await Promise.all([createUser(), createUser(), createUser()]);
  [sa, sb, sc] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token), sockets.connect(C.token)]);
  // A and B, and A and C, share conversations before any block.
  expect((await send(sa, B.userId)).ok).toBe(true);
  expect((await send(sa, C.userId)).ok).toBe(true);
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
  vi.mocked(sendMessagePushToUser).mockClear();
});

describe('T7.5 blocks', () => {
  it('block / list / unblock; self and unknown users are refused; blocking twice is idempotent', async () => {
    expect((await request(harness.app).post(`/users/${A.userId}/block`).set(auth(A.token))).status).toBe(400);
    expect((await request(harness.app).post('/users/65f0000000000000000000ff/block').set(auth(A.token))).status).toBe(404);
    expect((await request(harness.app).post(`/users/${B.userId}/block`).set(auth(A.token))).status).toBe(200);
    expect((await request(harness.app).post(`/users/${B.userId}/block`).set(auth(A.token))).status).toBe(200);
    const list = await request(harness.app).get('/users/me/blocks').set(auth(A.token));
    expect(list.body.items.map((i: { userId: string; username: string }) => [i.userId, typeof i.username])).toEqual([[B.userId, 'string']]);
    expect((await request(harness.app).get('/users/me/blocks').set(auth(B.token))).body.items).toEqual([]);
    expect((await request(harness.app).delete(`/users/${B.userId}/block`).set(auth(A.token))).status).toBe(200);
    expect((await request(harness.app).get('/users/me/blocks').set(auth(A.token))).body.items).toEqual([]);
    expect((await request(harness.app).delete(`/users/${B.userId}/block`).set(auth(A.token))).status).toBe(404);
  });

  it('while A blocks B: messages either way are dropped silently (ack ok, nothing stored, no event, no push); unblocking restores delivery', async () => {
    await request(harness.app).post(`/users/${B.userId}/block`).set(auth(A.token));
    const heldB = await heldFor(B.userId, B.token);
    const heldA = await heldFor(A.userId, A.token);

    const quietB = nextEvent(sb, 'message:new');
    const fromA = await send(sa, B.userId);
    expect(fromA.ok).toBe(true);
    expect(typeof fromA.serverMessageId).toBe('string'); // the sender learns nothing
    expect(await quietB).toBeNull();

    const quietA = nextEvent(sa, 'message:new');
    const fromB = await send(sb, A.userId);
    expect(fromB.ok).toBe(true);
    expect(await quietA).toBeNull();

    expect(await heldFor(B.userId, B.token)).toBe(heldB);
    expect(await heldFor(A.userId, A.token)).toBe(heldA);
    expect(vi.mocked(sendMessagePushToUser)).not.toHaveBeenCalled();

    // Presence and typing are not shared either way.
    const noPresence = nextEvent(sb, 'presence:update');
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await noPresence).toBeNull();
    const noTyping = nextEvent(sa, 'typing:update');
    sb.emit('typing:start', { toUserId: A.userId });
    expect(await noTyping).toBeNull();

    // The blocker's conversation list hides the pair; the blocked side's list is unchanged.
    const listA = await request(harness.app).get('/conversations').set(auth(A.token));
    expect(listA.body.items.some((c: { peerUserId: string }) => c.peerUserId === B.userId)).toBe(false);
    const listB = await request(harness.app).get('/conversations').set(auth(B.token));
    expect(listB.body.items.some((c: { peerUserId: string }) => c.peerUserId === A.userId)).toBe(true);

    await request(harness.app).delete(`/users/${B.userId}/block`).set(auth(A.token));
    const arrives = nextEvent<{ fromUserId: string }>(sb, 'message:new');
    expect((await send(sa, B.userId)).ok).toBe(true);
    expect(await arrives).toMatchObject({ fromUserId: A.userId });
  });

  it('group fan-out skips copies between a blocked pair; other members still receive', async () => {
    const g = await request(harness.app).post('/groups').set(auth(A.token)).send({ name: 'trio', memberIds: [B.userId, C.userId] });
    expect(g.status).toBe(201);
    await request(harness.app).post(`/users/${A.userId}/block`).set(auth(B.token)); // B blocks A
    const toC = nextEvent<{ fromUserId: string }>(sc, 'message:new');
    const toB = nextEvent(sb, 'message:new');
    const ack = await emitAck<{ ok: boolean; recipients: number }>(sa, 'group:send', { groupId: g.body.groupId, clientMessageId: 'g-1', createdAt: Date.now(), epoch: g.body.epoch, g1: g1() });
    expect(ack.ok).toBe(true);
    expect(ack.recipients).toBe(1);
    expect(await toC).toMatchObject({ fromUserId: A.userId });
    expect(await toB).toBeNull();
    await request(harness.app).delete(`/users/${A.userId}/block`).set(auth(B.token));
  });

  it('reports: stored with the reporter’s reason and excerpt; validated; self and unknown refused', async () => {
    const ok = await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: B.userId, reason: 'spam', excerpt: '  buy crypto now  ' });
    expect(ok.status).toBe(201);
    expect(typeof ok.body.reportId).toBe('string');
    const { ReportModel } = await import('../src/models/Report');
    const doc = await ReportModel.findById(ok.body.reportId).lean();
    expect(doc).toMatchObject({ reason: 'spam', excerpt: 'buy crypto now' });
    expect(String(doc!.reporterId)).toBe(A.userId);
    expect(String(doc!.reportedUserId)).toBe(B.userId);

    expect((await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: B.userId, reason: 'rude' })).status).toBe(400);
    expect((await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: B.userId, reason: 'abuse', excerpt: 'x'.repeat(2001) })).status).toBe(400);
    expect((await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: A.userId, reason: 'abuse' })).status).toBe(400);
    expect((await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: '65f0000000000000000000ff', reason: 'abuse' })).status).toBe(404);
    expect((await request(harness.app).post('/reports').send({ reportedUserId: B.userId, reason: 'abuse' })).status).toBe(401);
  });
});
