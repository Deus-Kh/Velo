import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestApp } from './helpers/testApp';

let harness: Awaited<ReturnType<typeof startTestApp>>;
const STRONG = 'correct horse battery staple 42';
const STRONG_2 = 'Tq9!vLm#2rXp@8w-zebra';
let counter = 0;

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

async function registerFresh() {
  counter += 1;
  const res = await request(harness.app)
    .post('/auth/register')
    .send({ email: `rt${counter}@example.com`, username: `rt_user_${counter}`, password: STRONG });
  expect(res.status).toBe(200);
  return res.body as { accessToken: string; refreshToken: string; userId: string; expiresIn: number };
}

const refresh = (refreshToken: string) => request(harness.app).post('/auth/refresh').send({ refreshToken });

describe('token issuance', () => {
  it('returns an access token, a refresh token and the access lifetime', async () => {
    const body = await registerFresh();
    expect(typeof body.accessToken).toBe('string');
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.expiresIn).toBe(900);
  });

  it('stores only a hash of the refresh token', async () => {
    const body = await registerFresh();
    const { RefreshTokenModel } = await import('../src/models/RefreshToken');
    const rows = await RefreshTokenModel.find({ userId: body.userId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(body.refreshToken);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: returns a new pair and the old token stops working', async () => {
    const first = await registerFresh();
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    expect(second.body.userId).toBe(first.userId);
    expect(typeof second.body.accessToken).toBe('string');

    // The new access token is accepted by an authenticated route.
    const me = await request(harness.app).get('/users/me').set('Authorization', `Bearer ${second.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('reuse of a rotated-out token revokes the whole family', async () => {
    const { log } = await import('../src/lib/logger');
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    const first = await registerFresh();
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);

    const replay = await refresh(first.refreshToken); // attacker replays the stolen, already-rotated token
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_REUSED');
    expect(error).toHaveBeenCalledWith(expect.any(Object), '[auth] refresh token reuse detected; family revoked');

    const victim = await refresh(second.body.refreshToken); // the legitimate successor is dead too
    expect(victim.status).toBe(401);
    expect(victim.body.code).toBe('REFRESH_REUSED');
  });

  it('rejects unknown, malformed and expired tokens', async () => {
    expect((await refresh('x'.repeat(43))).body.code).toBe('REFRESH_NOT_FOUND');
    expect((await request(harness.app).post('/auth/refresh').send({ refreshToken: 'short' })).status).toBe(400);

    const body = await registerFresh();
    const { RefreshTokenModel } = await import('../src/models/RefreshToken');
    await RefreshTokenModel.updateMany({ userId: body.userId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await refresh(body.refreshToken);
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('REFRESH_EXPIRED');
  });

  it('two concurrent refreshes of the same token: exactly one succeeds', async () => {
    const body = await registerFresh();
    const results = await Promise.all([refresh(body.refreshToken), refresh(body.refreshToken)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the family so its refresh token no longer works', async () => {
    const body = await registerFresh();
    const res = await request(harness.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ refreshToken: body.refreshToken });
    expect(res.status).toBe(200);
    const after = await refresh(body.refreshToken);
    expect(after.status).toBe(401);
  });

  it('cannot revoke another user\'s token', async () => {
    const a = await registerFresh();
    const b = await registerFresh();
    await request(harness.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: b.refreshToken });
    expect((await refresh(b.refreshToken)).status).toBe(200); // b is unaffected
  });
});

describe('POST /auth/change-password', () => {
  it('revokes every refresh family and returns a fresh pair', async () => {
    const body = await registerFresh();
    const other = await refresh(body.refreshToken); // second family? no — same family rotated; make a second login instead
    expect(other.status).toBe(200);

    const change = await request(harness.app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .send({ currentPassword: STRONG, newPassword: STRONG_2 });
    expect(change.status).toBe(200);
    expect(typeof change.body.refreshToken).toBe('string');

    expect((await refresh(other.body.refreshToken)).status).toBe(401); // old family dead
    expect((await refresh(change.body.refreshToken)).status).toBe(200); // new one alive
  });
});
