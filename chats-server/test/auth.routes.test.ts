import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers/testApp';

let harness: Awaited<ReturnType<typeof startTestApp>>;

const STRONG = 'correct horse battery staple 42';
const STRONG_2 = 'Tq9!vLm#2rXp@8w-zebra';

beforeAll(async () => {
  harness = await startTestApp();
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => harness.resetLimits());

const register = (body: Record<string, unknown>) => request(harness.app).post('/auth/register').send(body);
const login = (body: Record<string, unknown>) => request(harness.app).post('/auth/login').send(body);

describe('POST /auth/register', () => {
  it('rejects a 9-character password with a field error', async () => {
    const res = await register({ email: 'a1@example.com', username: 'alpha_one', password: 'abcdefghi' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.fields.password).toMatch(/at least 10/);
  });

  it('rejects a weak password that passes the length check', async () => {
    const res = await register({ email: 'a2@example.com', username: 'alpha_two', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.fields.password).toMatch(/too weak/);
  });

  it('rejects a password built from the user\'s own identifiers', async () => {
    // 14 characters, mixed classes — passes the length check, but it is the
    // username plus a year, which zxcvbn scores 1 once the username is known.
    const res = await register({ email: 'alpha.three@example.com', username: 'alphathree', password: 'alphathree2024' });
    expect(res.status).toBe(400);
    expect(res.body.fields.password).toMatch(/too weak/);
  });

  it('rejects an invalid email and a bad username, reporting both', async () => {
    const res = await register({ email: 'not-an-email', username: 'no spaces', password: STRONG });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['email', 'username']);
  });

  it('creates an account, normalising the email, and returns a token', async () => {
    const res = await register({ email: '  Alpha.Four@Example.COM ', username: 'AlphaFour', password: STRONG });
    expect(res.status).toBe(200);
    expect(res.body.userId).toMatch(/^[0-9a-f]{24}$/);
    expect(typeof res.body.accessToken).toBe('string');

    const { UserModel } = await import('../src/models/User');
    const user = await UserModel.findById(res.body.userId);
    expect(user?.email).toBe('alpha.four@example.com');
    expect(user?.username).toBe('AlphaFour'); // display casing preserved
    expect(user?.passwordHash).not.toContain(STRONG);
  });

  it('refuses duplicate emails and case-variant usernames', async () => {
    expect((await register({ email: 'dup@example.com', username: 'DupUser', password: STRONG })).status).toBe(200);
    const email = await register({ email: 'DUP@example.com', username: 'other_user', password: STRONG });
    expect(email.status).toBe(409);
    expect(email.body.code).toBe('EMAIL_TAKEN');
    const username = await register({ email: 'dup2@example.com', username: 'dupuser', password: STRONG });
    expect(username.status).toBe(409);
    expect(username.body.code).toBe('USERNAME_TAKEN');
  });

  it('never echoes the password back', async () => {
    const res = await register({ email: 'echo@example.com', username: 'echo_user', password: STRONG });
    expect(JSON.stringify(res.body)).not.toContain(STRONG);
  });
});

describe('POST /auth/login', () => {
  it('validates the body and signs in with normalised email', async () => {
    await register({ email: 'login@example.com', username: 'login_user', password: STRONG });
    expect((await login({ email: '', password: '' })).status).toBe(400);
    expect((await login({ email: 'login@example.com', password: 'wrong-password' })).status).toBe(401);
    // The failed attempt above armed the per-account backoff (T1.5); clear it.
    harness.resetLimits();
    const ok = await login({ email: ' LOGIN@example.com ', password: STRONG });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.accessToken).toBe('string');
  });
});

describe('POST /auth/change-password', () => {
  it('enforces current password, policy, and difference from the old one', async () => {
    const reg = await register({ email: 'chg@example.com', username: 'chg_user', password: STRONG });
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const change = (body: Record<string, unknown>) =>
      request(harness.app).post('/auth/change-password').set(auth).send(body);

    expect((await change({ currentPassword: 'nope', newPassword: STRONG_2 })).status).toBe(401);

    const weak = await change({ currentPassword: STRONG, newPassword: 'password123' });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.newPassword).toBeDefined();

    const same = await change({ currentPassword: STRONG, newPassword: STRONG });
    expect(same.status).toBe(400);
    expect(same.body.fields.newPassword).toMatch(/differ/);

    expect((await change({ currentPassword: STRONG, newPassword: STRONG_2 })).status).toBe(200);
    expect((await login({ email: 'chg@example.com', password: STRONG })).status).toBe(401);
    harness.resetLimits(); // clear the backoff armed by the failed login above
    expect((await login({ email: 'chg@example.com', password: STRONG_2 })).status).toBe(200);
  });
});

describe('POST /keys/* with schema validation', () => {
  it('rejects keys of the wrong length with field errors', async () => {
    const reg = await register({ email: 'keys@example.com', username: 'keys_user', password: STRONG });
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64');

    const identity = await request(harness.app).post('/keys/identity').set(auth).send({ identitySignPublicKey: b64(31) });
    expect(identity.status).toBe(400);
    expect(identity.body.fields.identitySignPublicKey).toMatch(/32 bytes/);

    const spk = await request(harness.app).post('/keys/signed-prekey').set(auth).send({ keyId: 1, publicKey: b64(32), signature: b64(63) });
    expect(spk.status).toBe(400);
    expect(spk.body.fields.signature).toMatch(/64 bytes/);

    const good = await request(harness.app).post('/keys/signed-prekey').set(auth).send({ keyId: 1, publicKey: b64(32), signature: b64(64) });
    expect(good.status).toBe(200);
  });
});
