import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';

vi.mock('../src/push/firebase', () => ({ sendMessagePushToUser: vi.fn(async () => undefined) }));

/**
 * T7.4 — privacy toggles (P2-10). Defaults are the product promise (no
 * presence broadcast); each toggle is enforced by the server where it
 * would otherwise tell a peer something.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let sockets: Awaited<ReturnType<typeof startTestSocketServer>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let sa: Socket;
let sb: Socket;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const encHeaderB64 = Buffer.alloc(85, 7).toString('base64');
const v4Payload = () => ({ encHeader: encHeaderB64, ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) });

async function sendAtoB(clientMessageId: string): Promise<string> {
  const ack = await emitAck<{ ok: boolean; serverMessageId: string }>(sa, 'message:send', {
    toUserId: B.userId, clientMessageId, createdAt: Date.now(), protoVersion: 4, v4: v4Payload(),
  });
  expect(ack, JSON.stringify(ack)).toMatchObject({ ok: true });
  return ack.serverMessageId;
}

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B] = await Promise.all([createUser(), createUser()]);
  [sa, sb] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token)]);
  await sendAtoB('cm-seed'); // A and B now share a conversation
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
});

describe('T7.4 privacy settings', () => {
  it('defaults: read receipts and typing on, last seen and online off; visible on /users/me; PATCH is partial and validated', async () => {
    const me = await request(harness.app).get('/users/me').set(auth(A.token));
    expect(me.status).toBe(200);
    expect(me.body.privacy).toEqual({ readReceipts: true, typing: true, lastSeen: false, online: false });

    const get = await request(harness.app).get('/users/me/privacy').set(auth(A.token));
    expect(get.body).toEqual({ readReceipts: true, typing: true, lastSeen: false, online: false });

    const patch = await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ online: true });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ readReceipts: true, typing: true, lastSeen: false, online: true });
    expect((await request(harness.app).get('/users/me/privacy').set(auth(A.token))).body.online).toBe(true);

    expect((await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({})).status).toBe(400);
    expect((await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ online: 'yes' })).status).toBe(400);
    expect((await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ colour: true })).status).toBe(400);
    expect((await request(harness.app).get('/users/me/privacy')).status).toBe(401);

    await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ online: false });
  });

  it('presence: hidden by default (online false, no last seen); shown once the user allows it', async () => {
    // resetLimits() (beforeEach) rebuilds the services, presence store included: reconnect A so it is online now.
    const a2 = await sockets.connect(A.token);
    // B asks for A's presence. A is connected, but A has not opted in.
    const hidden = nextEvent<{ userId: string; online: boolean; lastSeenAt: number | null }>(sb, 'presence:update');
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await hidden).toEqual({ userId: A.userId, online: false, lastSeenAt: null });

    await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ online: true, lastSeen: true });
    const shown = nextEvent<{ userId: string; online: boolean; lastSeenAt: number | null }>(sb, 'presence:update');
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await shown).toEqual({ userId: A.userId, online: true, lastSeenAt: null }); // online now; never disconnected in this store

    // A goes offline: last seen is recorded and, being allowed, shown; online is false.
    a2.close();
    await new Promise((r) => setTimeout(r, 150));
    const offline = nextEvent<{ online: boolean; lastSeenAt: number | null }>(sb, 'presence:update');
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    const q = await offline;
    expect(q?.online).toBe(false);
    expect(typeof q?.lastSeenAt).toBe('number');

    // Last seen withdrawn: nothing is shown any more.
    await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ lastSeen: false, online: false });
    const withdrawn = nextEvent<{ online: boolean; lastSeenAt: number | null }>(sb, 'presence:update');
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await withdrawn).toMatchObject({ online: false, lastSeenAt: null });
  });

  it('typing: forwarded while allowed, dropped once the typer turns it off', async () => {
    const seen = nextEvent<{ fromUserId: string; isTyping: boolean }>(sb, 'typing:update');
    sa.emit('typing:start', { toUserId: B.userId });
    expect(await seen).toMatchObject({ fromUserId: A.userId, isTyping: true });

    await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ typing: false });
    const silence = nextEvent(sb, 'typing:update');
    sa.emit('typing:start', { toUserId: B.userId });
    expect(await silence).toBeNull();
    await request(harness.app).patch('/users/me/privacy').set(auth(A.token)).send({ typing: true });
  });

  it('read receipts: the messages are marked read either way; the sender is told only if the reader allows it', async () => {
    await sendAtoB('cm-read-1');
    await request(harness.app).patch('/users/me/privacy').set(auth(B.token)).send({ readReceipts: false });
    const silence = nextEvent(sa, 'message:status-changed');
    const ack = await emitAck<{ ok: boolean; modified: number }>(sb, 'message:read', { peerUserId: A.userId });
    expect(ack.ok).toBe(true);
    expect(ack.modified).toBeGreaterThan(0);
    expect(await silence).toBeNull();

    await request(harness.app).patch('/users/me/privacy').set(auth(B.token)).send({ readReceipts: true });
    await sendAtoB('cm-read-2');
    const told = nextEvent<{ status: string; readerUserId: string }>(sa, 'message:status-changed');
    await emitAck(sb, 'message:read', { peerUserId: A.userId });
    expect(await told).toMatchObject({ status: 'read', readerUserId: B.userId });
  });
});
