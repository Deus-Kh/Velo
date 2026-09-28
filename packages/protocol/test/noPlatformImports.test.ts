import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The protocol package must stay pure: no React Native, storage, keychain,
 * or network imports (spec T2.1). Enforced here so it holds even without
 * ESLint.
 */
const FORBIDDEN = [
  /from ['"]react-native/,
  /from ['"]@react-native/,
  /from ['"]@react-native-async-storage/,
  /from ['"]react-native-keychain['"]/,
  /from ['"]axios['"]/,
  /from ['"]socket\.io-client['"]/,
  /require\(['"]react-native/,
  /\.\.\/\.\.\/chats-client/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('purity', () => {
  it('src/ imports no platform, storage, or network modules', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..', 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${file}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it('src/ has no async I/O entry points', () => {
    // Pure functions only: nothing in the package may await storage or the network.
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..', 'src'))) {
      const text = readFileSync(file, 'utf8');
      if (/\bawait\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
