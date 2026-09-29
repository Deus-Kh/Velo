import dotenv from 'dotenv';
import { resolveEnvFile } from './envFile';

// Two environments: DOTENV_CONFIG_PATH (explicit) > .env.<NODE_ENV> > .env; see envFile.ts.
export const ENV_FILE = resolveEnvFile(process.env.NODE_ENV, process.env.DOTENV_CONFIG_PATH);
if (ENV_FILE) dotenv.config({ path: ENV_FILE, quiet: true });

/**
 * Server configuration.
 *
 * Every secret is REQUIRED from the environment. There are deliberately no
 * fallbacks: a missing value must fail at boot, never silently at runtime.
 * Locally: copy `.env.development.example` to `.env.development` (or
 * `.env.example` to `.env.production`). Never commit either.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Locally copy .env.development.example to .env.development and provide a value.`,
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
  /** Access-token lifetime. Short by design; refresh tokens (T1.10) extend sessions. */
  JWT_ACCESS_TTL: optionalString('JWT_ACCESS_TTL', '900s'),
  JWT_REFRESH_TTL_DAYS: optionalNumber('JWT_REFRESH_TTL_DAYS', 30),

  BCRYPT_ROUNDS: optionalNumber('BCRYPT_ROUNDS', 12),

  /** T4.5: pino level (trace|debug|info|warn|error|fatal). */
  LOG_LEVEL: optionalString('LOG_LEVEL', NODE_ENV === 'test' ? 'silent' : 'info'),

  /** T4.6: bearer token for GET /metrics. Empty = the endpoint does not exist. */
  METRICS_TOKEN: optionalString('METRICS_TOKEN', ''),

  /** T3.1: undelivered ciphertext and delivery receipts expire after this many days (TTL index on Message.expiresAt). */
  MESSAGE_TTL_DAYS: optionalNumber('MESSAGE_TTL_DAYS', 30),
  // T8.2: ciphertext blobs. Local files under BLOB_DIR by default; an S3-compatible bucket when S3_* are set.
  ATTACHMENT_TTL_DAYS: optionalNumber('ATTACHMENT_TTL_DAYS', 30),
  BLOB_DIR: optionalString('BLOB_DIR', ''),
  /** Prefix for the URLs the local store hands to clients ('' = relative to the API base the client already uses). */
  PUBLIC_BASE_URL: optionalString('PUBLIC_BASE_URL', ''),
  S3_ENDPOINT: optionalString('S3_ENDPOINT', ''),
  S3_REGION: optionalString('S3_REGION', 'us-east-1'),
  S3_BUCKET: optionalString('S3_BUCKET', ''),
  S3_ACCESS_KEY_ID: optionalString('S3_ACCESS_KEY_ID', ''),
  S3_SECRET_ACCESS_KEY: optionalString('S3_SECRET_ACCESS_KEY', ''),
  S3_PATH_STYLE: optionalString('S3_PATH_STYLE', 'true'),

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
