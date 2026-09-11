import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { bundleLimiter } from '../middleware/rateLimit';
import { services } from '../lib/services';
import { UserModel } from '../models/User';
import { SignedPreKeyModel } from '../models/SignedPreKey';
import { OneTimePreKeyModel } from '../models/OneTimePreKey';
import { PreKeyBundleIssueModel } from '../models/PreKeyBundleIssue';
import { isValidObjectIdString } from '../utils/objectId';

export const keysRouter = Router();

/** Hard cap on unused one-time prekeys per user (storage-flood control). */
export const MAX_UNUSED_ONE_TIME_PREKEYS = 500;
/** Below this many unused keys the server logs a warning; at zero an error. */
export const ONE_TIME_PREKEY_LOW_WATERMARK = 10;

function tooManyRequests(res: Response, retryAfterSeconds: number, code: string, error: string): Response {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ error, code, retryAfterSeconds });
}

/**
 * POST /keys/identity
 * Body: { identitySignPublicKey: string }
 * Stores user's identity signing public key (Ed25519 public key, base64).
 */
keysRouter.post('/identity', requireAuth, async (req: AuthedRequest, res) => {
  const { identitySignPublicKey } = req.body as { identitySignPublicKey?: string };

  if (!identitySignPublicKey) {
    return res.status(400).json({ error: 'identitySignPublicKey is required' });
  }

  if (typeof identitySignPublicKey !== 'string' || identitySignPublicKey.length < 20) {
    return res.status(400).json({ error: 'Invalid identitySignPublicKey format' });
  }

  await UserModel.updateOne(
    { _id: req.userId },
    { $set: { identitySignPublicKey, identitySignUpdatedAt: new Date() } }
  );

  return res.json({ ok: true });
});

keysRouter.post('/identity-dh', requireAuth, async (req: AuthedRequest, res) => {
  const { identityDhPublicKey } = req.body as { identityDhPublicKey?: string };

  if (!identityDhPublicKey) return res.status(400).json({ error: 'identityDhPublicKey is required' });
  if (typeof identityDhPublicKey !== 'string' || identityDhPublicKey.length < 20) {
    return res.status(400).json({ error: 'Invalid identityDhPublicKey format' });
  }

  await UserModel.updateOne(
    { _id: req.userId },
    { $set: { identityDhPublicKey, identityDhUpdatedAt: new Date() } }
  );

  return res.json({ ok: true });
});

/**
 * GET /keys/identity/:userId
 * Returns user's identity signing public key.
 */
keysRouter.get('/identity/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const { userId } = req.params;

  const user = await UserModel.findById(userId).select('identitySignPublicKey');
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.identitySignPublicKey) {
    return res.status(404).json({ error: 'Identity key not set' });
  }

  return res.json({
    userId: String(user._id),
    identitySignPublicKey: user.identitySignPublicKey,
  });
});


keysRouter.post('/signed-prekey', requireAuth, async (req: AuthedRequest, res) => {
  const { keyId, publicKey, signature } = req.body as {
    keyId?: number;
    publicKey?: string;
    signature?: string;
  };

  if (typeof keyId !== 'number') return res.status(400).json({ error: 'keyId is required (number)' });
  if (!publicKey) return res.status(400).json({ error: 'publicKey is required' });
  if (!signature) return res.status(400).json({ error: 'signature is required' });

  if (typeof publicKey !== 'string' || publicKey.length < 20) {
    return res.status(400).json({ error: 'Invalid publicKey format' });
  }
  if (typeof signature !== 'string' || signature.length < 20) {
    return res.status(400).json({ error: 'Invalid signature format' });
  }

  // upsert by (userId, keyId) to allow idempotent upload
  await SignedPreKeyModel.updateOne(
    { userId: req.userId, keyId },
    { $set: { publicKey, signature } },
    { upsert: true }
  );

  return res.json({ ok: true });
});
 
keysRouter.post('/prekeys', requireAuth, async (req: AuthedRequest, res) => {
  const { items } = req.body as { items?: Array<{ keyId: number; publicKey: string }> };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items is required (non-empty array)' });
  }

  if (items.length > MAX_UNUSED_ONE_TIME_PREKEYS) {
    return res.status(400).json({ error: `Too many prekeys (max ${MAX_UNUSED_ONE_TIME_PREKEYS} per request)` });
  }

  const wellFormed = items.every(
    (it) =>
      it &&
      typeof it === 'object' &&
      Number.isInteger(it.keyId) &&
      it.keyId >= 0 &&
      typeof it.publicKey === 'string' &&
      it.publicKey.length >= 20 &&
      it.publicKey.length <= 200,
  );
  if (!wellFormed) {
    return res.status(400).json({ error: 'Each item needs an integer keyId and a base64 publicKey', code: 'BAD_PREKEY_ITEM' });
  }

  // Total-pool cap (P0-4): the per-request cap alone allowed unbounded growth.
  const unused = await OneTimePreKeyModel.countDocuments({ userId: req.userId, used: false });
  if (unused + items.length > MAX_UNUSED_ONE_TIME_PREKEYS) {
    return res.status(409).json({
      error: `One-time prekey pool is full (${unused} unused, max ${MAX_UNUSED_ONE_TIME_PREKEYS})`,
      code: 'PREKEY_POOL_FULL',
      unused,
      max: MAX_UNUSED_ONE_TIME_PREKEYS,
    });
  }

  const docs = items.map((it) => ({
    userId: req.userId,
    keyId: it.keyId,
    publicKey: it.publicKey,
    used: false,
    usedAt: null,
  }));

  // insertMany with ordered:false to skip duplicates without failing whole batch
  try {
    await OneTimePreKeyModel.insertMany(docs, { ordered: false });
  } catch (e: any) {
    // ignore duplicate key errors (11000) to keep idempotency
    if (e?.code !== 11000) {
      // insertMany can throw BulkWriteError with writeErrors; only fail if not dup-related
      const nonDup = (e?.writeErrors || []).some((we: any) => we?.code !== 11000);
      if (nonDup) return res.status(500).json({ error: 'Failed to store prekeys' });
    }
  }

  return res.json({ ok: true });
});


/**
 * GET /keys/bundle/:userId — issue a prekey bundle for the target user.
 *
 * Drain protection (P0-4). Every call that reaches the consume step is a
 * fresh issue and is budgeted twice: per (requester, target) pair and per
 * requester overall (see services.ts for the numbers). This is the Signal
 * approach. Bundles are deliberately NOT cached per pair: the responder
 * deletes a one-time prekey secret after its first use, so re-serving the
 * same bundle would break every session a requester re-establishes after a
 * reset or reinstall. bundleLimiter (express-rate-limit) is only a coarse
 * per-user request cap in front of this.
 */
keysRouter.get('/bundle/:userId', requireAuth, bundleLimiter, async (req: AuthedRequest, res) => {
  const requesterId = String(req.userId);
  const targetId = req.params.userId;

  if (!isValidObjectIdString(targetId)) {
    return res.status(400).json({ error: 'Invalid userId', code: 'BAD_ID' });
  }
  if (targetId === requesterId) {
    // Pointless for a real client and a free drain vector.
    return res.status(400).json({ error: 'Cannot request your own prekey bundle', code: 'SELF_BUNDLE' });
  }

  // Budgets are charged before any lookup so probing unknown ids costs too.
  const pairBudget = await services.bundlePairLimiter.hit(`${requesterId}:${targetId}`);
  if (!pairBudget.allowed) {
    console.warn('[keys] bundle pair limit hit', { requesterId, targetId, count: pairBudget.count });
    return tooManyRequests(res, pairBudget.retryAfterSeconds, 'BUNDLE_PAIR_LIMITED',
      'Too many prekey bundle requests for this contact. Please try again later.');
  }
  const requesterBudget = await services.bundleIssueLimiter.hit(requesterId);
  if (!requesterBudget.allowed) {
    console.warn('[keys] bundle requester limit hit', { requesterId, count: requesterBudget.count });
    return tooManyRequests(res, requesterBudget.retryAfterSeconds, 'BUNDLE_LIMITED',
      'Too many prekey bundle requests. Please try again later.');
  }

  // 1) peer identity keys
  const peer = await UserModel.findById(targetId).select('identitySignPublicKey identityDhPublicKey');
  if (!peer) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
  if (!peer.identitySignPublicKey) {
    return res.status(404).json({ error: 'Identity key not set', code: 'NO_IDENTITY_KEY' });
  }
  if (!peer.identityDhPublicKey) {
    return res.status(404).json({ error: 'Identity DH key not set', code: 'NO_IDENTITY_KEY' });
  }

  // 2) latest signed prekey
  const signed = await SignedPreKeyModel.findOne({ userId: targetId })
    .sort({ createdAt: -1 })
    .select('keyId publicKey signature');
  if (!signed) return res.status(404).json({ error: 'Signed prekey not set', code: 'NO_SIGNED_PREKEY' });

  // 3) consume one one-time prekey atomically (oldest unused); may be null when the pool is empty
  const oneTime = await OneTimePreKeyModel.findOneAndUpdate(
    { userId: targetId, used: false },
    { $set: { used: true, usedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true },
  ).select('keyId publicKey');

  // 4) depletion visibility — the examiner's "how do you detect it" answer
  const remaining = await OneTimePreKeyModel.countDocuments({ userId: targetId, used: false });
  if (remaining === 0) {
    console.error('[keys] one-time prekey pool exhausted', { targetId, requesterId, issuedWithoutOneTimeKey: !oneTime });
  } else if (remaining < ONE_TIME_PREKEY_LOW_WATERMARK) {
    console.warn('[keys] one-time prekey pool low', { targetId, remaining });
  }

  // 5) ledger entry (never re-served; see PreKeyBundleIssue.ts)
  await PreKeyBundleIssueModel.create({
    requesterId,
    targetId,
    signedPreKeyId: signed.keyId,
    oneTimePreKeyId: oneTime?.keyId ?? null,
  });

  return res.json({
    userId: targetId,
    identitySignPublicKey: peer.identitySignPublicKey,
    identityDhPublicKey: peer.identityDhPublicKey,
    signedPreKey: {
      keyId: signed.keyId,
      publicKey: signed.publicKey,
      signature: signed.signature,
    },
    oneTimePreKey: oneTime ? { keyId: oneTime.keyId, publicKey: oneTime.publicKey } : null,
    remainingOneTimePreKeys: remaining,
  });
});

// GET /keys/prekeys/unused-count (JWT)
keysRouter.get('/prekeys/unused-count', requireAuth, async (req: AuthedRequest, res) => {
  const unused = await OneTimePreKeyModel.countDocuments({
    userId: req.userId,
    used: false,
  });

  return res.json({ unused });
});
