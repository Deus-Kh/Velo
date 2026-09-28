import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';

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

const b64 = (n: number, fill: number) => Buffer.alloc(n, fill).toString('base64');

function upload(token: string, keyId: number) {
  return request(harness.app)
    .post('/keys/signed-prekey')
    .set('Authorization', `Bearer ${token}`)
    .send({ keyId, publicKey: b64(32, keyId), signature: b64(64, keyId) });
}

describe('POST /keys/signed-prekey (T2.10 rotation)', () => {
  it('keeps only the five most recent signed prekeys per user and serves the newest in the bundle', async () => {
    const me = await createUser({ withKeys: true, oneTimePreKeys: 1 }); // createUser already stored keyId 1000+n
    const peer = await createUser();
    const { SignedPreKeyModel } = await import('../src/models/SignedPreKey');

    for (const keyId of [11, 12, 13, 14, 15, 16, 17]) {
      const res = await upload(me.token, keyId);
      expect(res.status).toBe(200);
    }
    const remaining = await SignedPreKeyModel.find({ userId: me.userId }).sort({ createdAt: -1 }).lean();
    expect(remaining).toHaveLength(5);
    expect(remaining.map((k) => k.keyId)).toEqual([17, 16, 15, 14, 13]);

    const bundle = await request(harness.app).get(`/keys/bundle/${me.userId}`).set('Authorization', `Bearer ${peer.token}`);
    expect(bundle.status).toBe(200);
    expect(bundle.body.signedPreKey.keyId).toBe(17);
  });

  it('re-uploading an existing key id is idempotent and does not evict anything', async () => {
    const me = await createUser({ withKeys: false });
    const { SignedPreKeyModel } = await import('../src/models/SignedPreKey');
    await upload(me.token, 21);
    await upload(me.token, 22);
    await upload(me.token, 21);
    const remaining = await SignedPreKeyModel.find({ userId: me.userId }).lean();
    expect(remaining.map((k) => k.keyId).sort()).toEqual([21, 22]);
  });
});
