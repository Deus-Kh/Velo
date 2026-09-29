import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';

/**
 * Socket authorization (T1.7 / P0-7).
 *
 * A and B share a conversation (A messages B). C is a stranger to both.
 * Every check below is "what can C do to A or B", plus the non-regression
 * of read → delivered.
 */

let harness: Awaited<ReturnType<typeof startTestApp>>;
let sockets: Awaited<ReturnType<typeof startTestSocketServer>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let C: Awaited<ReturnType<typeof createUser>>;
let sa: Socket;
let sb: Socket;
let sc: Socket;
let serverMessageId: string;

const encHeaderB64 = Buffer.alloc(85, 7).toString('base64'); // T3.6: fixed-size encrypted header
const v4Payload = () => ({
  encHeader: encHeaderB64,
  ciphertext: 'C'.repeat(64),
  mac: 'M'.repeat(24),
});

async function messageStatus(id: string): Promise<string> {
  const { MessageModel } = await import('../src/models/Message');
  const doc = await MessageModel.findById(id).select('status');
  return String(doc?.status);
}

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B, C] = await Promise.all([createUser(), createUser(), createUser()]);
  [sa, sb, sc] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token), sockets.connect(C.token)]);

  // A → B establishes the conversation.
  const incoming = nextEvent<{ serverMessageId: string }>(sb, 'message:new', 2000);
  const ack = await emitAck<{ ok: boolean; serverMessageId: string }>(sa, 'message:send', {
    toUserId: B.userId,
    clientMessageId: 'cm-1',
    createdAt: Date.now(),
    protoVersion: 4,
    v4: v4Payload(),
  });
  expect(ack.ok).toBe(true);
  serverMessageId = ack.serverMessageId;
  expect((await incoming)?.serverMessageId).toBe(serverMessageId);
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

describe('handshake', () => {
  it('rejects a bad token', async () => {
    await expect(sockets.connect('not.a.jwt')).rejects.toThrow(/Unauthorized/);
  });
});

describe('message:send', () => {
  it('refuses self-send and unknown recipients', async () => {
    const self = await emitAck<{ ok: boolean; code: string }>(sa, 'message:send', {
      toUserId: A.userId, clientMessageId: 'cm-self', createdAt: Date.now(), protoVersion: 4, v4: v4Payload(),
    });
    expect(self).toMatchObject({ ok: false, code: 'SELF_SEND' });

    const ghost = await emitAck<{ ok: boolean; code: string }>(sa, 'message:send', {
      toUserId: '65f0000000000000000000ff', clientMessageId: 'cm-ghost', createdAt: Date.now(), protoVersion: 4, v4: v4Payload(),
    });
    expect(ghost).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('message:delivered', () => {
  it('is refused for anyone but the recipient, without mutating the message', async () => {
    const ack = await emitAck<{ ok: boolean; code: string }>(sc, 'message:delivered', { serverMessageId });
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await messageStatus(serverMessageId)).toBe('sent');
  });

  it('rejects a malformed id', async () => {
    const ack = await emitAck<{ ok: boolean; code: string }>(sb, 'message:delivered', { serverMessageId: 'nope' });
    expect(ack).toMatchObject({ ok: false, code: 'BAD_ID' });
  });

  it('works for the recipient and notifies the sender with a server-derived conversationId', async () => {
    const notice = nextEvent<{ status: string; conversationId: string; deliveredByUserId: string }>(sa, 'message:status-changed');
    const ack = await emitAck<{ ok: boolean; status: string }>(sb, 'message:delivered', { serverMessageId });
    expect(ack).toMatchObject({ ok: true, status: 'delivered' });
    expect(await messageStatus(serverMessageId)).toBe('delivered');

    const { makeConversationId } = await import('../src/utils/conversation');
    expect(await notice).toMatchObject({
      status: 'delivered',
      conversationId: makeConversationId(A.userId, B.userId),
      deliveredByUserId: B.userId,
    });
  });
});

describe('message:read', () => {
  it('is refused for a stranger, and the target hears nothing', async () => {
    const silence = nextEvent(sa, 'message:status-changed');
    const ack = await emitAck<{ ok: boolean; code: string }>(sc, 'message:read', { peerUserId: A.userId });
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await silence).toBeNull();
  });

  it('refuses a crafted legacy conversationId', async () => {
    const { makeConversationId } = await import('../src/utils/conversation');
    // B tries to emit a read receipt "inside" a conversation it is not part of.
    const ack = await emitAck<{ ok: boolean; code: string }>(sb, 'message:read', {
      conversationId: makeConversationId(A.userId, C.userId),
    });
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('works for a participant and notifies the peer', async () => {
    const notice = nextEvent<{ status: string; readerUserId: string }>(sa, 'message:status-changed');
    const ack = await emitAck<{ ok: boolean; modified: number }>(sb, 'message:read', { peerUserId: A.userId });
    expect(ack).toMatchObject({ ok: true, modified: 1 });
    expect(await messageStatus(serverMessageId)).toBe('read');
    expect(await notice).toMatchObject({ status: 'read', readerUserId: B.userId });
  });

  it('never regresses read to delivered', async () => {
    const ack = await emitAck<{ ok: boolean; status: string }>(sb, 'message:delivered', { serverMessageId });
    expect(ack).toMatchObject({ ok: true, status: 'read' });
    expect(await messageStatus(serverMessageId)).toBe('read');
  });
});

describe('presence', () => {
  it('a stranger gets no presence for A', async () => {
    const update = nextEvent(sc, 'presence:update');
    sc.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await update).toBeNull();
  });

  it('a conversation partner does, and sees only what the peer allows (T7.4: hidden by default)', async () => {
    const update = nextEvent<{ userId: string; online: boolean; lastSeenAt: number | null }>(sb, 'presence:update', 2000);
    sb.emit('presence:subscribe', { peerUserId: A.userId });
    expect(await update).toEqual({ userId: A.userId, online: false, lastSeenAt: null });
  });
});

describe('typing', () => {
  it('a stranger cannot spray typing indicators', async () => {
    const update = nextEvent(sa, 'typing:update');
    sc.emit('typing:start', { toUserId: A.userId, conversationId: 'anything' });
    expect(await update).toBeNull();
  });

  it('a partner can, and the conversationId is derived server-side', async () => {
    const { makeConversationId } = await import('../src/utils/conversation');
    const update = nextEvent<{ fromUserId: string; conversationId: string; isTyping: boolean }>(sa, 'typing:update', 2000);
    sb.emit('typing:start', { toUserId: A.userId, conversationId: 'client-supplied-garbage' });
    expect(await update).toEqual({
      fromUserId: B.userId,
      conversationId: makeConversationId(A.userId, B.userId),
      isTyping: true,
    });
  });
});
