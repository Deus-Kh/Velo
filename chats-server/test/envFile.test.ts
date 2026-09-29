import { describe, expect, it } from 'vitest';
import { resolveEnvFile } from '../src/envFile';

/**
 * Two environments: which env file the server loads. An explicit path wins;
 * otherwise `.env.<NODE_ENV>` when it exists, else `.env`, else nothing (the
 * process environment alone, as under systemd).
 */
describe('resolveEnvFile', () => {
  const only = (...present: string[]) => (p: string) => present.includes(p);

  it('prefers DOTENV_CONFIG_PATH, then .env.<mode>, then .env', () => {
    expect(resolveEnvFile('development', './custom.env', only('.env.development', '.env'))).toBe('./custom.env');
    expect(resolveEnvFile('development', undefined, only('.env.development', '.env'))).toBe('.env.development');
    expect(resolveEnvFile('production', undefined, only('.env.production', '.env'))).toBe('.env.production');
    expect(resolveEnvFile('production', undefined, only('.env'))).toBe('.env');
    expect(resolveEnvFile('production', '', only('.env'))).toBe('.env');
  });

  it('an unset NODE_ENV means development; nothing on disk means the process environment only', () => {
    expect(resolveEnvFile(undefined, undefined, only('.env.development'))).toBe('.env.development');
    expect(resolveEnvFile('', undefined, only('.env.development'))).toBe('.env.development');
    expect(resolveEnvFile('test', undefined, only())).toBeNull();
  });
});
