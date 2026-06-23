import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { SignedPreKeyModel } from '../models/SignedPreKey';
import { OneTimePreKeyModel } from '../models/OneTimePreKey';


export const keysRouter = Router();

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

  if (items.length > 500) {
    return res.status(400).json({ error: 'Too many prekeys (max 500 per request)' });
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


keysRouter.get('/bundle/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const peerUserId = req.params.userId;

  // 1) peer identity key (Ed25519 pub) from User
  // const peer = await UserModel.findById(peerUserId).select('identitySignPublicKey');
  const peer = await UserModel.findById(peerUserId).select('identitySignPublicKey identityDhPublicKey');

  if (!peer) return res.status(404).json({ error: 'User not found' });
  if (!peer.identitySignPublicKey) {
    return res.status(404).json({ error: 'Identity key not set' });
  }
  if (!peer.identityDhPublicKey) {
  return res.status(404).json({ error: 'Identity DH key not set' });
}


  // 2) latest signed prekey
  const signed = await SignedPreKeyModel.findOne({ userId: peerUserId })
    .sort({ createdAt: -1 })
    .select('keyId publicKey signature');

  if (!signed) return res.status(404).json({ error: 'Signed prekey not set' });

  // 3) consume one-time prekey (optional)
  const oneTime = await OneTimePreKeyModel.findOneAndUpdate(
    { userId: peerUserId, used: false },
    { $set: { used: true, usedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true } // take oldest unused
  ).select('keyId publicKey');

  return res.json({
    userId: peerUserId,
    identitySignPublicKey: peer.identitySignPublicKey,
    identityDhPublicKey: peer.identityDhPublicKey,
    signedPreKey: {
      keyId: signed.keyId,
      publicKey: signed.publicKey,
      signature: signed.signature,
    },
    oneTimePreKey: oneTime
      ? { keyId: oneTime.keyId, publicKey: oneTime.publicKey }
      : null,
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
