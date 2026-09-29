import bcrypt from 'bcrypt';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { emitAck, nextEvent, startTestSocketServer } from './helpers/testSocket';

vi.mock('../src/push/firebase', () => ({ sendMessagePushToUser: vi.fn(async () => undefined) }));

/**
 * T7.6 — account deletion (GDPR Art. 17): password re-entry, a full cascade
 * on the server, peers told, sockets dropped, groups left with a rotation.
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

beforeAll(async () => {
  harness = await startTestApp();
  sockets = await startTestSocketServer(harness.app);
  [A, B, C] = await Promise.all([createUser({ oneTimePreKeys: 3 }), createUser(), createUser()]);
  [sa, sb, sc] = await Promise.all([sockets.connect(A.token), sockets.connect(B.token), sockets.connect(C.token)]);
  const { UserModel } = await import('../src/models/User');
  await UserModel.updateOne({ _id: A.userId }, { $set: { passwordHash: await bcrypt.hash('correct horse battery', 4) } });
});

afterAll(async () => {
  await sockets.stop();
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
});

describe('T7.6 account deletion', () => {
  it('requires the password; wrong or missing is refused and nothing changes', async () => {
    expect((await request(harness.app).delete('/auth/account').set(auth(A.token)).send({})).status).toBe(400);
    expect((await request(harness.app).delete('/auth/account').set(auth(A.token)).send({ password: 'nope' })).status).toBe(401);
    expect((await request(harness.app).delete('/auth/account').send({ password: 'correct horse battery' })).status).toBe(401);
    const { UserModel } = await import('../src/models/User');
    expect(await UserModel.exists({ _id: A.userId })).toBeTruthy();
  });

  it('deletes everything the server holds, leaves groups with a rotation, tells peers, drops the socket', async () => {
    // State before: A<->B messages (one undelivered for B), B fetched A's bundle, A blocked C, A reported C, a group A/B/C.
    expect((await emitAck<{ ok: boolean }>(sa, 'message:send', { toUserId: B.userId, clientMessageId: 'cm-1', createdAt: Date.now(), protoVersion: 4, v4: v4Payload() })).ok).toBe(true);
    expect((await emitAck<{ ok: boolean }>(sb, 'message:send', { toUserId: A.userId, clientMessageId: 'cm-2', createdAt: Date.now(), protoVersion: 4, v4: v4Payload() })).ok).toBe(true);
    expect((await request(harness.app).get(`/keys/bundle/${A.userId}`).set(auth(B.token))).status).toBe(200);
    expect((await request(harness.app).post(`/users/${C.userId}/block`).set(auth(A.token))).status).toBe(200);
    const report = await request(harness.app).post('/reports').set(auth(A.token)).send({ reportedUserId: C.userId, reason: 'spam' });
    expect(report.status).toBe(201);
    const g = await request(harness.app).post('/groups').set(auth(A.token)).send({ name: 'trio', memberIds: [B.userId, C.userId] });
    expect(g.status).toBe(201);
    const epochBefore = g.body.epoch as number;

    const {
      UserModel, MessageModel, ConversationModel, SignedPreKeyModel, OneTimePreKeyModel, PreKeyBundleIssueModel, RefreshTokenModel, BlockModel, ReportModel, GroupModel,
    } = {
      UserModel: (await import('../src/models/User')).UserModel,
      MessageModel: (await import('../src/models/Message')).MessageModel,
      ConversationModel: (await import('../src/models/Conversation')).ConversationModel,
      SignedPreKeyModel: (await import('../src/models/SignedPreKey')).SignedPreKeyModel,
      OneTimePreKeyModel: (await import('../src/models/OneTimePreKey')).OneTimePreKeyModel,
      PreKeyBundleIssueModel: (await import('../src/models/PreKeyBundleIssue')).PreKeyBundleIssueModel,
      RefreshTokenModel: (await import('../src/models/RefreshToken')).RefreshTokenModel,
      BlockModel: (await import('../src/models/Block')).BlockModel,
      ReportModel: (await import('../src/models/Report')).ReportModel,
      GroupModel: (await import('../src/models/Group')).GroupModel,
    };
    await RefreshTokenModel.create({ userId: A.userId, family: 'fam-a', tokenHash: 'h'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await MessageModel.countDocuments({ $or: [{ fromUserId: A.userId }, { toUserId: A.userId }] })).toBeGreaterThan(0);
    expect(await SignedPreKeyModel.countDocuments({ userId: A.userId })).toBeGreaterThan(0);
    expect(await OneTimePreKeyModel.countDocuments({ userId: A.userId })).toBeGreaterThan(0);
    expect(await PreKeyBundleIssueModel.countDocuments({ targetId: A.userId }), JSON.stringify({ all: await PreKeyBundleIssueModel.find({}).lean(), A: A.userId, B: B.userId })).toBeGreaterThan(0);

    const toldB = nextEvent<{ userId: string }>(sb, 'user:deleted', 2000);
    const toldC = nextEvent<{ userId: string }>(sc, 'user:deleted', 2000);
    const groupNoticeB = nextEvent<{ groupId: string; epoch: number; change: { type: string; userIds: string[] } }>(sb, 'group:changed', 2000);
    const dropped = new Promise<void>((resolve) => sa.once('disconnect', () => resolve()));

    const res = await request(harness.app).delete('/auth/account').set(auth(A.token)).send({ password: 'correct horse battery' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: true });

    // Peers told, group left with a rotation, socket dropped.
    expect(await toldB).toEqual({ userId: A.userId });
    expect(await toldC).toEqual({ userId: A.userId });
    expect(await groupNoticeB).toMatchObject({ groupId: g.body.groupId, epoch: epochBefore + 1, change: { type: 'left', userIds: [A.userId] } });
    await dropped;
    const group = await GroupModel.findById(g.body.groupId).lean();
    expect(group!.members.map((m) => String(m.userId)).sort()).toEqual([B.userId, C.userId].sort());
    expect(group!.members.some((m) => m.role === 'admin')).toBe(true); // promotion: the deleted user was the only admin

    // Nothing of A remains; reports A filed remain without the reporter.
    expect(await UserModel.exists({ _id: A.userId })).toBeNull();
    expect(await MessageModel.countDocuments({ $or: [{ fromUserId: A.userId }, { toUserId: A.userId }] })).toBe(0);
    expect(await ConversationModel.countDocuments({ members: A.userId })).toBe(0);
    expect(await SignedPreKeyModel.countDocuments({ userId: A.userId })).toBe(0);
    expect(await OneTimePreKeyModel.countDocuments({ userId: A.userId })).toBe(0);
    expect(await PreKeyBundleIssueModel.countDocuments({ $or: [{ requesterId: A.userId }, { targetId: A.userId }] })).toBe(0);
    expect(await RefreshTokenModel.countDocuments({ userId: A.userId })).toBe(0);
    expect(await BlockModel.countDocuments({ $or: [{ blockerId: A.userId }, { blockedId: A.userId }] })).toBe(0);
    const kept = await ReportModel.findById(report.body.reportId).lean();
    expect(kept).not.toBeNull();
    expect(kept!.reporterId).toBeNull();
    expect(String(kept!.reportedUserId)).toBe(C.userId);

    // B's world afterwards: no conversation with A, no bundle for A, sending to A is "not found".
    expect((await request(harness.app).get('/conversations').set(auth(B.token))).body.items.some((c: { peerUserId: string }) => c.peerUserId === A.userId)).toBe(false);
    expect((await request(harness.app).get(`/keys/bundle/${A.userId}`).set(auth(B.token))).status).toBe(404);
    expect(await emitAck<{ ok: boolean; code: string }>(sb, 'message:send', { toUserId: A.userId, clientMessageId: 'cm-3', createdAt: Date.now(), protoVersion: 4, v4: v4Payload() })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // A's still-valid access token no longer identifies anyone.
    expect((await request(harness.app).get('/users/me').set(auth(A.token))).status).toBe(404);
  });
});
