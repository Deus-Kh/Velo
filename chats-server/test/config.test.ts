import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * config.ts validates the environment at import time, so every case reloads
 * the module with a fresh environment. DOTENV_CONFIG_PATH is pointed at a file
 * that does not exist so the developer's real .env can never leak into a test.
 */

const VALID_ENV: Record<string, string> = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/velo-test',
  JWT_SECRET: 'x'.repeat(32),
  FIREBASE_SERVICE_ACCOUNT_PATH: './does-not-matter-for-config.json',
};

const CONFIG_KEYS = [
  'NODE_ENV',
  'PORT',
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_ACCESS_TTL',
  'JWT_REFRESH_TTL_DAYS',
  'BCRYPT_ROUNDS',
  'REDIS_URL',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  'CORS_ORIGINS',
];

async function loadConfig(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv('DOTENV_CONFIG_PATH', './definitely-missing.env');
  for (const key of CONFIG_KEYS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  const mod = await import('../src/config');
  return mod.config;
}

describe('config', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('fails loudly when MONGO_URI is missing', async () => {
    await expect(loadConfig({ MONGO_URI: undefined })).rejects.toThrow(
      /Missing required environment variable: MONGO_URI/,
    );
  });

  it('fails loudly when JWT_SECRET is missing', async () => {
    await expect(loadConfig({ JWT_SECRET: undefined })).rejects.toThrow(
      /Missing required environment variable: JWT_SECRET/,
    );
  });

  it('rejects a JWT_SECRET shorter than 32 characters', async () => {
    await expect(loadConfig({ JWT_SECRET: 'short' })).rejects.toThrow(/at least 32 characters/);
  });

  it('rejects a non-numeric BCRYPT_ROUNDS', async () => {
    await expect(loadConfig({ BCRYPT_ROUNDS: 'twelve' })).rejects.toThrow(/must be numeric/);
  });

  it('rejects an out-of-range BCRYPT_ROUNDS', async () => {
    await expect(loadConfig({ BCRYPT_ROUNDS: '4' })).rejects.toThrow(/between 10 and 15/);
  });

  it('requires FIREBASE_SERVICE_ACCOUNT_PATH', async () => {
    await expect(loadConfig({ FIREBASE_SERVICE_ACCOUNT_PATH: undefined })).rejects.toThrow(
      /FIREBASE_SERVICE_ACCOUNT_PATH/,
    );
  });

  it('loads a valid environment with documented defaults', async () => {
    const config = await loadConfig();
    expect(config.MONGO_URI).toBe(VALID_ENV.MONGO_URI);
    expect(config.PORT).toBe(9999);
    expect(config.JWT_ALGORITHM).toBe('HS256');
    expect(config.JWT_ACCESS_TTL).toBe('900s');
    expect(config.BCRYPT_ROUNDS).toBe(12);
    expect(config.NODE_ENV).toBe('development');
    expect(config.IS_PRODUCTION).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([]);
  });

  it('parses CORS_ORIGINS as a trimmed list and honours overrides', async () => {
    const config = await loadConfig({
      CORS_ORIGINS: ' https://a.example , https://b.example ,',
      PORT: '8080',
      NODE_ENV: 'production',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(config.PORT).toBe(8080);
    expect(config.IS_PRODUCTION).toBe(true);
  });
});
