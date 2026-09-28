import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, startTestApp, tokenFor } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';

/**
 * T3.2 — server sequence numbers (P2-6, P2-9).
 * `seq` is assigned atomically per conversation on send; ordering and the
 * undelivered cursor use it; the sender's clock (`createdAt`) is display only.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let sockets: Awaited<ReturnType<typeof startTestSocketServer>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let C: Awaited<ReturnType<typeof createUser>>;
let sa: Socket;
let sb: Socket;

const encHeaderB64 = Buffer.alloc(85, 7).toString('base64'); // T3.6: fixed-size encrypted header
const v4Payload = (n: number) => ({
  encHeader: encHeaderB64,
  ciphertext: 'C'.repeat(48) + String(n).padStart(16, 'C'),
  mac: 'M'.repeat(24),
});

type SendAck = { ok: boolean; serverMessageId: string; seq: number };

function send(socket: Socket, toUserId: string, clientMessageId: string, createdAt: number, n = 0) {
  return emitAck<SendAck>(socket, 'message:send', { toUserId, clientMessageId, createdAt, protoVersion: 4, v4: v4Payload(n) });
}

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B, C] = await Promise.all([createUser(), createUser(), createUser()]);
  [sa, sb] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token)]);
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

describe('T3.2 sequence numbers', () => {
  it('assigns seq per conversation in send order, independent of the client clock, and carries it everywhere', async () => {
    const farFuture = Date.now() + 10 * 365 * 24 * 3600 * 1000;
    const first = nextEvent<{ serverMessageId: string; seq: number }>(sb, 'message:new', 2000);
    const a1 = await send(sa, B.userId, 'seq-1', farFuture, 0); // a client pinning itself to the top (P2-9)
    expect(a1).toMatchObject({ ok: true, seq: 1 });
    expect((await first).seq).toBe(1);

    const second = nextEvent<{ serverMessageId: string; seq: number }>(sb, 'message:new', 2000);
    const a2 = await send(sa, B.userId, 'seq-2', 1_700_000_000_000, 1); // earlier clock, later send
    expect(a2).toMatchObject({ ok: true, seq: 2 });
    expect((await second).seq).toBe(2);

    // Another conversation has its own counter.
    const c1 = await send(sa, C.userId, 'seq-c1', Date.now());
    expect(c1.seq).toBe(1);

    // The undelivered listing is in seq order, not clock order, and the cursor is seq.
    const list = await request(harness.app).get(`/messages/undelivered?peerUserId=${A.userId}`).set('Authorization', `Bearer ${tokenFor(B.userId)}`);
    expect(list.body.items.map((i: any) => [i.seq, i.clientMessageId])).toEqual([[1, 'seq-1'], [2, 'seq-2']]);
    const paged = await request(harness.app).get(`/messages/undelivered?peerUserId=${A.userId}&after=1`).set('Authorization', `Bearer ${tokenFor(B.userId)}`);
    expect(paged.body.items.map((i: any) => i.seq)).toEqual([2]);

    // A resend of the same clientMessageId gets the same id and seq, never a new one.
    const again = await send(sa, B.userId, 'seq-1', farFuture, 0);
    expect(again).toMatchObject({ ok: true, serverMessageId: a1.serverMessageId, seq: 1 });

    // The conversation orders by server time, not by the pinned client timestamp.
    const { ConversationModel } = await import('../src/models/Conversation');
    const { makeConversationId } = await import('../src/utils/conversation');
    const conv = await ConversationModel.findOne({ conversationId: makeConversationId(A.userId, B.userId) }).lean();
    expect((conv as any).lastSeq).toBe(2);
    expect((conv as any).lastMessageAt).toBeLessThan(farFuture - 365 * 24 * 3600 * 1000);
    expect((conv as any).lastMessageAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('the (conversation, seq) pair is unique on the collection', async () => {
    const { MessageModel } = await import('../src/models/Message');
    await MessageModel.syncIndexes();
    const indexes = await MessageModel.collection.indexes();
    const idx = indexes.find((i: any) => i.key?.conversationId === 1 && i.key?.seq === 1 && i.key?.toUserId === 1); // T6.3: per recipient
    expect(idx).toBeDefined();
    expect((idx as any).unique).toBe(true);
    expect((idx as any).partialFilterExpression).toEqual({ seq: { $type: 'number' } });
  });

  it('refuses the previous wire version and a malformed encrypted header (T3.6)', async () => {
    const old = await emitAck<{ ok: boolean; code: string }>(sa, 'message:send', { toUserId: B.userId, clientMessageId: 'old-1', createdAt: Date.now(), protoVersion: 3, v3: { header: { n: 0, pn: 0, dhPub: 'D'.repeat(44) }, ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) } });
    expect(old).toMatchObject({ ok: false, code: 'UNSUPPORTED_PROTO_VERSION' });
    const short = await emitAck<{ ok: boolean; error: string }>(sa, 'message:send', { toUserId: B.userId, clientMessageId: 'bad-1', createdAt: Date.now(), protoVersion: 4, v4: { encHeader: Buffer.alloc(84, 7).toString('base64'), ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) } });
    expect(short).toMatchObject({ ok: false, error: 'Invalid v4 payload' });
  });
});
