import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp, tokenFor } from './helpers/testApp';

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

async function usedCount(userId: string): Promise<number> {
  const { OneTimePreKeyModel } = await import('../src/models/OneTimePreKey');
  return OneTimePreKeyModel.countDocuments({ userId, used: true });
}

async function ledgerCount(filter: Record<string, unknown>): Promise<number> {
  const { PreKeyBundleIssueModel } = await import('../src/models/PreKeyBundleIssue');
  return PreKeyBundleIssueModel.countDocuments(filter);
}

function getBundle(token: string, targetId: string) {
  return request(harness.app).get(`/keys/bundle/${targetId}`).set('Authorization', `Bearer ${token}`);
}

describe('GET /keys/bundle/:userId', () => {
  it('requires authentication', async () => {
    const target = await createUser({ oneTimePreKeys: 1 });
    const res = await request(harness.app).get(`/keys/bundle/${target.userId}`);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed id and a request for your own bundle', async () => {
    const me = await createUser({ oneTimePreKeys: 1 });
    expect((await getBundle(me.token, 'not-an-object-id')).status).toBe(400);
    const self = await getBundle(me.token, me.userId);
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('SELF_BUNDLE');
    expect(await usedCount(me.userId)).toBe(0);
  });

  it('returns 404 for a user without keys, without consuming anything', async () => {
    const me = await createUser();
    const bare = await createUser({ withKeys: false });
    const res = await getBundle(me.token, bare.userId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_IDENTITY_KEY');
  });

  it('issues a bundle, consumes exactly one one-time prekey, and records the issue', async () => {
    const me = await createUser();
    const target = await createUser({ oneTimePreKeys: 3 });

    const res = await getBundle(me.token, target.userId);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(target.userId);
    expect(res.body.identitySignPublicKey).toMatch(/^IKSIGN/);
    expect(res.body.identityDhPublicKey).toMatch(/^IKDH/);
    expect(res.body.signedPreKey.keyId).toBeGreaterThan(1000);
    expect(res.body.oneTimePreKey).toEqual({ keyId: 1, publicKey: expect.stringMatching(/^OPK/) });
    expect(res.body.remainingOneTimePreKeys).toBe(2);

    expect(await usedCount(target.userId)).toBe(1);
    expect(await ledgerCount({ requesterId: me.userId, targetId: target.userId, oneTimePreKeyId: 1 })).toBe(1);
  });

  it('a second request for the same target issues a FRESH one-time prekey (no re-serving)', async () => {
    const me = await createUser();
    const target = await createUser({ oneTimePreKeys: 3 });

    const first = await getBundle(me.token, target.userId);
    const second = await getBundle(me.token, target.userId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.oneTimePreKey.keyId).not.toBe(first.body.oneTimePreKey.keyId);
    expect(await usedCount(target.userId)).toBe(2);
  });

  it('bounds one requester to 5 issues per target per hour', async () => {
    const me = await createUser();
    const target = await createUser({ oneTimePreKeys: 20 });

    for (let i = 0; i < 5; i += 1) {
      expect((await getBundle(me.token, target.userId)).status).toBe(200);
    }
    const sixth = await getBundle(me.token, target.userId);
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('BUNDLE_PAIR_LIMITED');
    expect(sixth.headers['retry-after']).toBeDefined();
    expect(await usedCount(target.userId)).toBe(5);
  });

  it('bounds one requester to 30 issues per hour across all targets', async () => {
    const me = await createUser();
    const targets = [];
    for (let i = 0; i < 31; i += 1) targets.push(await createUser({ oneTimePreKeys: 1 }));

    for (let i = 0; i < 30; i += 1) {
      expect((await getBundle(me.token, targets[i].userId)).status).toBe(200);
    }
    const blocked = await getBundle(me.token, targets[30].userId);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('BUNDLE_LIMITED');
    expect(await usedCount(targets[30].userId)).toBe(0);
  });

  it('100 sequential requests from one requester consume at most 5 keys of one target', async () => {
    const me = await createUser();
    const target = await createUser({ oneTimePreKeys: 100 });
    for (let i = 0; i < 100; i += 1) await getBundle(me.token, target.userId);
    expect(await usedCount(target.userId)).toBeLessThanOrEqual(5);
  });

  it('logs a warning below the low watermark and an error at exhaustion; then issues without a one-time key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const requesters = await Promise.all([createUser(), createUser(), createUser()]);
    const target = await createUser({ oneTimePreKeys: 2 });

    // 2 → 1 remaining: low watermark warning
    expect((await getBundle(requesters[0].token, target.userId)).body.remainingOneTimePreKeys).toBe(1);
    expect(warn).toHaveBeenCalledWith('[keys] one-time prekey pool low', expect.objectContaining({ remaining: 1 }));

    // 1 → 0 remaining: exhaustion error
    expect((await getBundle(requesters[1].token, target.userId)).body.remainingOneTimePreKeys).toBe(0);
    expect(error).toHaveBeenCalledWith('[keys] one-time prekey pool exhausted', expect.objectContaining({ targetId: target.userId }));

    // pool empty: bundle still issued, without a one-time key
    const dry = await getBundle(requesters[2].token, target.userId);
    expect(dry.status).toBe(200);
    expect(dry.body.oneTimePreKey).toBeNull();
    expect(dry.body.remainingOneTimePreKeys).toBe(0);
  });
});

describe('POST /keys/prekeys', () => {
  function upload(token: string, items: unknown) {
    return request(harness.app).post('/keys/prekeys').set('Authorization', `Bearer ${token}`).send({ items });
  }

  const validKey = () => Buffer.alloc(32, 1).toString('base64'); // 32 bytes, like a real X25519 key

  it('rejects malformed items with field errors', async () => {
    const me = await createUser();
    const res = await upload(me.token, [{ keyId: 'one', publicKey: 'A'.repeat(44) }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.fields['items.0.keyId']).toBeDefined();
    expect(res.body.fields['items.0.publicKey']).toMatch(/32 bytes/);
  });

  it('caps the unused pool at 500 keys', async () => {
    const me = await createUser({ oneTimePreKeys: 495 });
    const tooMany = await upload(
      me.token,
      Array.from({ length: 10 }, (_, i) => ({ keyId: 10_000 + i, publicKey: validKey() })),
    );
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe('PREKEY_POOL_FULL');

    const justEnough = await upload(
      me.token,
      Array.from({ length: 5 }, (_, i) => ({ keyId: 20_000 + i, publicKey: validKey() })),
    );
    expect(justEnough.status).toBe(200);

    const count = await request(harness.app)
      .get('/keys/prekeys/unused-count')
      .set('Authorization', `Bearer ${tokenFor(me.userId)}`);
    expect(count.body.unused).toBe(500);
  });
});
