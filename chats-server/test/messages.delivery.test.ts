import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp, tokenFor } from './helpers/testApp';
import * as realtime from '../src/lib/realtime';

/**
 * T3.1 — delete-on-delivery, TTL, undelivered endpoint (P1-10 server side).
 * The server holds ciphertext only until the recipient's device acks; what
 * remains is a metadata-only receipt with an expiry.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
  vi.restoreAllMocks();
});

const envelope = (n: number) => ({ header: { n, pn: 0, dhPub: 'DH'.padEnd(44, 'A') }, ciphertext: 'CT'.padEnd(64, 'B'), mac: 'M'.padEnd(24, 'C') });

async function storeMessage(from: string, to: string, n: number, createdAt: number) {
  const { MessageModel } = await import('../src/models/Message');
  const { makeConversationId } = await import('../src/utils/conversation');
  const { messageExpiry } = await import('../src/lib/delivery');
  const doc = await MessageModel.create({
    conversationId: makeConversationId(from, to),
    fromUserId: new Types.ObjectId(from),
    toUserId: new Types.ObjectId(to),
    protoVersion: 3,
    v3: envelope(n),
    initPacket: n === 0 ? { peerUserId: to, ephPublicKey: 'E'.padEnd(44, 'E'), signedPreKeyId: 1, oneTimePreKeyId: 7, initiatorIdentityDhPublicKey: 'I'.padEnd(44, 'I') } : null,
    clientMessageId: `${from}-${n}`,
    createdAtClient: createdAt,
    expiresAt: messageExpiry(createdAt),
  });
  return String(doc._id);
}

const get = (path: string, token: string) => request(harness.app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string, token: string, body?: unknown) => request(harness.app).post(path).set('Authorization', `Bearer ${token}`).send(body);

async function rawDoc(id: string) {
  const { MessageModel } = await import('../src/models/Message');
  return MessageModel.findById(id).lean();
}

describe('T3.1 delete-on-delivery', () => {
  it('lists undelivered ciphertext for the recipient only, oldest first, with an after cursor', async () => {
    const a = await createUser();
    const b = await createUser();
    const t0 = 1_700_000_000_000;
    const m0 = await storeMessage(a.userId, b.userId, 0, t0);
    const m1 = await storeMessage(a.userId, b.userId, 1, t0 + 1000);

    const forB = await get(`/messages/undelivered?peerUserId=${a.userId}`, tokenFor(b.userId));
    expect(forB.status).toBe(200);
    expect(forB.body.items.map((i: any) => i.serverMessageId)).toEqual([m0, m1]);
    expect(forB.body.items[0].initPacket).not.toBeNull();
    expect(forB.body.items[0].v3.ciphertext).toBe(envelope(0).ciphertext);

    const forA = await get(`/messages/undelivered?peerUserId=${b.userId}`, tokenFor(a.userId));
    expect(forA.body.items).toEqual([]);

    const paged = await get(`/messages/undelivered?peerUserId=${a.userId}&after=${t0}`, tokenFor(b.userId));
    expect(paged.body.items.map((i: any) => i.serverMessageId)).toEqual([m1]);
  });

  it('the recipient ack deletes the ciphertext, keeps a receipt, notifies the sender once, and clears the listing', async () => {
    const a = await createUser();
    const b = await createUser();
    const id = await storeMessage(a.userId, b.userId, 0, 1_700_000_100_000);
    const emit = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});

    const ack = await post('/messages/delivered', tokenFor(b.userId), { serverMessageIds: [id] });
    expect(ack.status).toBe(200);
    expect(ack.body.results[id]).toBe('delivered');

    const doc = (await rawDoc(id)) as any;
    expect(doc.v3).toBeUndefined();
    expect(doc.initPacket).toBeUndefined();
    expect(doc.status).toBe('delivered');
    expect(typeof doc.deliveredAt).toBe('number');
    expect(doc.expiresAt.getTime()).toBeGreaterThan(doc.deliveredAt);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toBe(a.userId);
    expect(emit.mock.calls[0]![1]).toBe('message:status-changed');
    expect(emit.mock.calls[0]![2]).toMatchObject({ status: 'delivered', serverMessageId: id, deliveredByUserId: b.userId });

    const again = await post('/messages/delivered', tokenFor(b.userId), { serverMessageIds: [id] });
    expect(again.body.results[id]).toBe('delivered');
    expect(emit).toHaveBeenCalledTimes(1);

    const listing = await get(`/messages/undelivered?peerUserId=${a.userId}`, tokenFor(b.userId));
    expect(listing.body.items).toEqual([]);
  });

  it('only the recipient may ack; a stranger or the sender leaves the ciphertext in place', async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const id = await storeMessage(a.userId, b.userId, 0, 1_700_000_200_000);

    const byStranger = await post('/messages/delivered', tokenFor(c.userId), { serverMessageIds: [id] });
    expect(byStranger.body.results[id]).toBe('FORBIDDEN');
    const bySender = await post('/messages/delivered', tokenFor(a.userId), { serverMessageIds: [id] });
    expect(bySender.body.results[id]).toBe('FORBIDDEN');
    const bogus = await post('/messages/delivered', tokenFor(b.userId), { serverMessageIds: ['nope', String(new Types.ObjectId())] });
    expect(Object.values(bogus.body.results)).toEqual(['BAD_ID', 'NOT_FOUND']);

    const doc = (await rawDoc(id)) as any;
    expect(doc.v3.ciphertext).toBe(envelope(0).ciphertext);
    expect(doc.status).toBe('sent');

    const bad = await post('/messages/delivered', tokenFor(b.userId), { serverMessageIds: 'x' });
    expect(bad.status).toBe(400);
  });

  it('read receipts still work on the metadata stub and reach an offline sender via receipts', async () => {
    const a = await createUser();
    const b = await createUser();
    const { makeConversationId } = await import('../src/utils/conversation');
    const id = await storeMessage(a.userId, b.userId, 0, 1_700_000_300_000);
    vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});

    const since = Date.now() - 1;
    await post('/messages/delivered', tokenFor(b.userId), { serverMessageIds: [id] });
    const read = await post(`/messages/mark-read/${makeConversationId(a.userId, b.userId)}`, tokenFor(b.userId));
    expect(read.body.updatedCount).toBe(1);

    const doc = (await rawDoc(id)) as any;
    expect(doc.status).toBe('read');
    expect(doc.v3).toBeUndefined();

    // A (the sender) syncs: nothing undelivered for A, but the receipt for A's own message is there.
    const sync = await get(`/messages/undelivered?peerUserId=${b.userId}&receiptsSince=${since}`, tokenFor(a.userId));
    expect(sync.body.items).toEqual([]);
    expect(sync.body.receipts).toHaveLength(1);
    expect(sync.body.receipts[0]).toMatchObject({ serverMessageId: id, clientMessageId: `${a.userId}-0`, status: 'read' });
    expect(typeof sync.body.receipts[0].readAt).toBe('number');
    expect(typeof sync.body.serverTime).toBe('number');

    const later = await get(`/messages/undelivered?peerUserId=${b.userId}&receiptsSince=${sync.body.serverTime}`, tokenFor(a.userId));
    expect(later.body.receipts).toEqual([]);
  });

  it('every message carries an expiry and the collection has a TTL index on it', async () => {
    const a = await createUser();
    const b = await createUser();
    const createdAt = 1_700_000_400_000;
    const id = await storeMessage(a.userId, b.userId, 0, createdAt);
    const { MessageModel } = await import('../src/models/Message');
    const { MESSAGE_TTL_MS } = await import('../src/lib/delivery');
    const doc = (await rawDoc(id)) as any;
    expect(doc.expiresAt.getTime()).toBe(createdAt + MESSAGE_TTL_MS);
    expect(MESSAGE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);

    await MessageModel.syncIndexes();
    const indexes = await MessageModel.collection.indexes();
    const ttl = indexes.find((i: any) => i.key?.expiresAt === 1);
    expect(ttl).toBeDefined();
    expect((ttl as any).expireAfterSeconds).toBe(0);
  });
});
