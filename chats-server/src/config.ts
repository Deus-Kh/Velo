import dotenv from 'dotenv';

// DOTENV_CONFIG_PATH lets tests and CI point at a different file (or at a
// nonexistent one to guarantee a clean environment). Default: ./.env in cwd.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined, quiet: true });

/**
 * Server configuration.
 *
 * Every secret is REQUIRED from the environment. There are deliberately no
 * fallbacks: a missing value must fail at boot, never silently at runtime.
 * Copy `.env.example` to `.env` and fill it in. Never commit `.env`.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and provide a value.`,
    );
  }
  return value.trim();
}

function optionalString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be numeric, got: ${raw}`);
  }
  return n;
}

const NODE_ENV = optionalString('NODE_ENV', 'development');

export const config = {
  NODE_ENV,
  IS_PRODUCTION: NODE_ENV === 'production',
  PORT: optionalNumber('PORT', 9999),

  MONGO_URI: required('MONGO_URI'),
  JWT_SECRET: required('JWT_SECRET'),

  JWT_ALGORITHM: 'HS256' as const,
  /**
   * Access-token lifetime. Target is 900s (15 min) once refresh tokens exist
   * (T1.10). Until then the default stays at 3h so users are not logged out
   * every 15 minutes; T1.10 lowers this default in the same change.
   */
  JWT_ACCESS_TTL: optionalString('JWT_ACCESS_TTL', '10800s'),
  JWT_REFRESH_TTL_DAYS: optionalNumber('JWT_REFRESH_TTL_DAYS', 30),

  BCRYPT_ROUNDS: optionalNumber('BCRYPT_ROUNDS', 12),

  /**
   * Check new passwords against the HaveIBeenPwned range API (k-anonymous:
   * only a 5-character hash prefix leaves the server). Fails open on network
   * errors. Set to "false" in tests or air-gapped environments.
   */
  PASSWORD_BREACH_CHECK: optionalString('PASSWORD_BREACH_CHECK', 'true') !== 'false',

  /**
   * Redis backs rate limits and login backoff. Empty in development means
   * in-memory stores (single process, reset on restart). Required in
   * production — enforced in redis.ts at boot.
   */
  REDIS_URL: optionalString('REDIS_URL', ''),

  /**
   * Path to the Firebase service-account JSON. Required so that push can never
   * silently fall back to application-default credentials on a misconfigured
   * host. Keep the file OUTSIDE the repository tree.
   */
  FIREBASE_SERVICE_ACCOUNT_PATH: required('FIREBASE_SERVICE_ACCOUNT_PATH'),

  /** Comma-separated list of allowed browser origins. Empty = none (native clients only). */
  CORS_ORIGINS: optionalString('CORS_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

if (config.JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48',
  );
}

if (config.BCRYPT_ROUNDS < 10 || config.BCRYPT_ROUNDS > 15) {
  throw new Error('BCRYPT_ROUNDS must be between 10 and 15');
}
