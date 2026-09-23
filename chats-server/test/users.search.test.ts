import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
// Note: never statically import anything that pulls in src/config.ts here —
// the environment is stubbed inside startTestApp(), which must run first.
import { escapeRegex } from '../src/utils/regex';

let harness: Awaited<ReturnType<typeof startTestApp>>;
let me: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  harness = await startTestApp();
  me = await createUser();
  const { UserModel } = await import('../src/models/User');
  await UserModel.insertMany([
    { email: 'alice@example.com', username: 'alice', passwordHash: 'x' },
    { email: 'alicia@example.com', username: 'Alicia', passwordHash: 'x' },
    { email: 'malice@example.com', username: 'malice', passwordHash: 'x' },
    { email: 'a.plus@example.com', username: 'a.plus+b', passwordHash: 'x' },
  ]);
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(() => harness.resetLimits());

function search(q: string | undefined, extra: Record<string, string> = {}) {
  const req = request(harness.app).get('/users').set('Authorization', `Bearer ${me.token}`);
  return req.query({ ...(q === undefined ? {} : { q }), ...extra });
}

describe('escapeRegex', () => {
  it('neutralises every metacharacter', () => {
    const raw = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegex(raw)}$`).test(raw)).toBe(true);
    expect(new RegExp(`^${escapeRegex('a.b')}$`).test('aXb')).toBe(false);
  });
});

describe('GET /users', () => {
  it('requires authentication', async () => {
    const res = await request(harness.app).get('/users').query({ q: 'ali' });
    expect(res.status).toBe(401);
  });

  it('returns nothing for a missing, empty, or too-short query (no directory dump)', async () => {
    expect((await search(undefined)).body).toEqual({ items: [] });
    expect((await search('')).body).toEqual({ items: [] });
    expect((await search('al')).body).toEqual({ items: [] });
  });

  it('matches a case-insensitive username prefix only', async () => {
    const res = await search('ali');
    expect(res.status).toBe(200);
    expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(['Alicia', 'alice']);
    // "malice" contains "ali" but does not start with it
    expect(res.body.items.some((u: { username: string }) => u.username === 'malice')).toBe(false);
  });

  it('never returns email addresses', async () => {
    const res = await search('ali');
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['hasPublicKey', 'userId', 'username']);
    }
  });

  it('does not search by email', async () => {
    // "malice@example.com" would have matched the old $or on email
    expect((await search('malice@')).body.items).toEqual([]);
  });

  it('treats regex metacharacters literally and answers quickly', async () => {
    const literal = await search('a.plus+b');
    expect(literal.body.items.map((u: { username: string }) => u.username)).toEqual(['a.plus+b']);

    const started = Date.now();
    const evil = await search('(a+)+$');
    expect(evil.status).toBe(200);
    expect(evil.body.items).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects an over-long query and caps the limit', async () => {
    expect((await search('x'.repeat(33))).status).toBe(400);
    const res = await search('ali', { limit: '1000' });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  it('excludes the caller', async () => {
    const res = await search('user');
    expect(res.body.items.some((u: { userId: string }) => u.userId === me.userId)).toBe(false);
  });
});

describe('GET /conversations', () => {
  it('does not expose peer emails', async () => {
    const peer = await createUser();
    const { ConversationModel } = await import('../src/models/Conversation');
    const { makeConversationId } = await import('../src/utils/conversation');
    await ConversationModel.create({
      conversationId: makeConversationId(me.userId, peer.userId),
      members: [me.userId, peer.userId],
      lastMessageAt: Date.now(),
      lastProtoVersion: 2,
    });

    const res = await request(harness.app).get('/conversations').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
    expect(res.body.items[0]).not.toHaveProperty('peerEmail');
    expect(res.body.items[0].peerUsername).toBeDefined();
  });
});
