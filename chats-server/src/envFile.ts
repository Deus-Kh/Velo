import { existsSync } from 'fs';

/**
 * Which env file the server loads (two environments, development and production):
 *   1. DOTENV_CONFIG_PATH, when set (tests and CI point it at a file, or at a
 *      nonexistent one to guarantee a clean environment);
 *   2. `.env.<NODE_ENV>` when that file exists (`.env.development` for
 *      `npm run dev`, where NODE_ENV is unset; `.env.production` for a local
 *      `NODE_ENV=production npm start`);
 *   3. `.env` otherwise; null when none exists (process environment only, as
 *      under systemd's EnvironmentFile).
 * dotenv never overrides a variable already present in the process.
 * Pure (the file check is injectable) so it can be tested without loading config.ts.
 */
export function resolveEnvFile(
  mode: string | undefined,
  explicit: string | undefined,
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (explicit && explicit.trim() !== '') return explicit;
  const modeFile = `.env.${(mode && mode.trim()) || 'development'}`;
  if (exists(modeFile)) return modeFile;
  return exists('.env') ? '.env' : null;
}
