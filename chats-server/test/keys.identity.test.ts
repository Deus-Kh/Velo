import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { IDENTITY_BINDING_DOMAIN } from '../src/lib/identityBinding';
import * as realtime from '../src/lib/realtime';

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

function boundIdentity(seed?: number) {
  const sign = seed === undefined ? nacl.sign.keyPair() : nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
  const dh = nacl.box.keyPair();
  const domain = Buffer.from(IDENTITY_BINDING_DOMAIN, 'utf8');
  const message = new Uint8Array(domain.length + 32);
  message.set(domain, 0);
  message.set(dh.publicKey, domain.length);
  return {
    identitySignPublicKey: encodeBase64(sign.publicKey),
    identityDhPublicKey: encodeBase64(dh.publicKey),
    identityBindingSignature: encodeBase64(nacl.sign.detached(message, sign.secretKey)),
  };
}

function upload(token: string, body: unknown) {
  return request(harness.app).post('/keys/identity').set('Authorization', `Bearer ${token}`).send(body);
}

async function prekeyCounts(userId: string) {
  const { SignedPreKeyModel } = await import('../src/models/SignedPreKey');
  const { OneTimePreKeyModel } = await import('../src/models/OneTimePreKey');
  return {
    signed: await SignedPreKeyModel.countDocuments({ userId }),
    oneTime: await OneTimePreKeyModel.countDocuments({ userId }),
  };
}

describe('POST /keys/identity (T2.13)', () => {
  it('stores a bound identity and serves it with the binding', async () => {
    const me = await createUser({ withKeys: false });
    const identity = boundIdentity();
    const res = await upload(me.token, identity);
    expect(res.status).toBe(200);

    const other = await createUser();
    const got = await request(harness.app).get(`/keys/identity/${me.userId}`).set('Authorization', `Bearer ${other.token}`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ userId: me.userId, ...identity, identityChangedAt: null });
  });

  it('rejects an identity whose binding does not verify', async () => {
    const me = await createUser({ withKeys: false });
    const a = boundIdentity();
    const b = boundIdentity();
    const res = await upload(me.token, { ...a, identityDhPublicKey: b.identityDhPublicKey });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDENTITY_BINDING_INVALID');
    const got = await request(harness.app).get(`/keys/identity/${me.userId}`).set('Authorization', `Bearer ${me.token}`);
    expect(got.status).toBe(404);
  });

  it('re-uploading the same identity changes nothing and purges nothing', async () => {
    const me = await createUser({ withKeys: false, oneTimePreKeys: 0 });
    const identity = boundIdentity(0x11);
    await upload(me.token, identity);
    const { SignedPreKeyModel } = await import('../src/models/SignedPreKey');
    await SignedPreKeyModel.create({ userId: me.userId, keyId: 1, publicKey: 'SPK', signature: 'SIG' });
    const emit = vi.spyOn(realtime, 'emitToUser');

    const res = await upload(me.token, identity);
    expect(res.status).toBe(200);
    expect((await prekeyCounts(me.userId)).signed).toBe(1);
    expect(emit).not.toHaveBeenCalled();
    const got = await request(harness.app).get(`/keys/identity/${me.userId}`).set('Authorization', `Bearer ${me.token}`);
    expect(got.body.identityChangedAt).toBeNull();
  });

  it('a different identity records history, purges the prekeys and notifies every conversation peer', async () => {
    const me = await createUser({ oneTimePreKeys: 5 }); // fake keys + 5 one-time prekeys
    const peer = await createUser();
    const stranger = await createUser();
    const { ConversationModel } = await import('../src/models/Conversation');
    await ConversationModel.create({
      conversationId: [me.userId, peer.userId].sort().join(':'),
      members: [me.userId, peer.userId],
      lastMessageAt: Date.now(),
    });
    expect((await prekeyCounts(me.userId))).toEqual({ signed: 1, oneTime: 5 });

    const emit = vi.spyOn(realtime, 'emitToUser');
    const fresh = boundIdentity();
    const res = await upload(me.token, fresh);
    expect(res.status).toBe(200);

    // Stale prekeys are gone (S10 finding): a new session to me cannot be built on old keys.
    expect(await prekeyCounts(me.userId)).toEqual({ signed: 0, oneTime: 0 });

    const { UserModel } = await import('../src/models/User');
    const user = await UserModel.findById(me.userId).lean();
    expect(user?.identityBindingSignature).toBe(fresh.identityBindingSignature);
    expect(user?.identityChangedAt).toBeInstanceOf(Date);
    expect(user?.identityKeyHistory).toHaveLength(1);
    expect(user?.identityKeyHistory?.[0]).toMatchObject({ identitySignPublicKey: expect.stringMatching(/^IKSIGN/) });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(peer.userId, 'identity:changed', expect.objectContaining({ userId: me.userId }));
    expect(emit).not.toHaveBeenCalledWith(stranger.userId, expect.anything(), expect.anything());

    // The identity lookup now reports the change time; the bundle refuses until new prekeys arrive.
    const got = await request(harness.app).get(`/keys/identity/${me.userId}`).set('Authorization', `Bearer ${peer.token}`);
    expect(got.body.identityChangedAt).not.toBeNull();
    const bundle = await request(harness.app).get(`/keys/bundle/${me.userId}`).set('Authorization', `Bearer ${peer.token}`);
    expect(bundle.status).toBe(404);
    expect(bundle.body.code).toBe('NO_SIGNED_PREKEY');
  });

  it('the bundle carries the binding and refuses an identity without one', async () => {
    const me = await createUser();
    const target = await createUser({ oneTimePreKeys: 1 });
    const bundle = await request(harness.app).get(`/keys/bundle/${target.userId}`).set('Authorization', `Bearer ${me.token}`);
    expect(bundle.status).toBe(200);
    expect(typeof bundle.body.identityBindingSignature).toBe('string');

    const { UserModel } = await import('../src/models/User');
    await UserModel.updateOne({ _id: target.userId }, { $set: { identityBindingSignature: null } });
    const again = await request(harness.app).get(`/keys/bundle/${target.userId}`).set('Authorization', `Bearer ${me.token}`);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('NO_IDENTITY_BINDING');
  });
});
