import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { vi } from 'vitest';

/**
 * Shared harness for route tests: stubs the required environment, boots an
 * in-memory MongoDB, and returns the Express app plus helpers to create users
 * and tokens. Store-backed services are reset per test by the caller.
 */

export const TEST_JWT_SECRET = 't'.repeat(48);

export async function startTestApp() {
  vi.stubEnv('DOTENV_CONFIG_PATH', './definitely-missing.env');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('MONGO_URI', 'mongodb://127.0.0.1:1/unused-because-we-connect-manually');
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_PATH', './missing-service-account.json');
  vi.stubEnv('REDIS_URL', '');
  vi.stubEnv('PASSWORD_BREACH_CHECK', 'false'); // no network in tests; breachCount() has its own unit test

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const { createApp } = await import('../../src/app');
  const { configureServices } = await import('../../src/lib/services');
  const { configureRateLimiters } = await import('../../src/middleware/rateLimit');

  const app = createApp();

  const resetLimits = () => {
    configureServices(null);
    configureRateLimiters(null);
  };

  const stop = async () => {
    await mongoose.disconnect();
    await mongod.stop();
    vi.unstubAllEnvs();
  };

  return { app, resetLimits, stop };
}

export function tokenFor(userId: string): string {
  return jwt.sign({ userId }, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
}

let userCounter = 0;

/**
 * Inserts a user directly through the models (no HTTP), optionally with
 * identity keys, one signed prekey, and `oneTimePreKeys` unused one-time keys.
 */
export async function createUser(opts: { withKeys?: boolean; oneTimePreKeys?: number } = {}) {
  const { UserModel } = await import('../../src/models/User');
  const { SignedPreKeyModel } = await import('../../src/models/SignedPreKey');
  const { OneTimePreKeyModel } = await import('../../src/models/OneTimePreKey');

  userCounter += 1;
  const n = userCounter;
  const withKeys = opts.withKeys ?? true;

  const user = await UserModel.create({
    email: `user${n}@example.com`,
    username: `user${n}`,
    passwordHash: 'x',
    identitySignPublicKey: withKeys ? `IKSIGN${String(n).padStart(38, '0')}` : null,
    identityDhPublicKey: withKeys ? `IKDH${String(n).padStart(40, '0')}` : null,
  });
  const userId = String(user._id);

  if (withKeys) {
    await SignedPreKeyModel.create({
      userId: new Types.ObjectId(userId),
      keyId: 1000 + n,
      publicKey: `SPK${String(n).padStart(41, '0')}`,
      signature: `SIG${String(n).padStart(83, '0')}`,
    });
    const count = opts.oneTimePreKeys ?? 0;
    if (count > 0) {
      await OneTimePreKeyModel.insertMany(
        Array.from({ length: count }, (_, i) => ({
          userId: new Types.ObjectId(userId),
          keyId: i + 1,
          publicKey: `OPK${String(n).padStart(20, '0')}${String(i).padStart(21, '0')}`,
          used: false,
          usedAt: null,
        })),
      );
    }
  }

  return { userId, token: tokenFor(userId) };
}
