import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  base64Bytes,
  emailSchema,
  fieldErrorsFromZod,
  preKeysUploadSchema,
  registerSchema,
  signedPreKeySchema,
  usernameSchema,
} from '../src/utils/validation';
import { breachCount, checkPasswordPolicy, checkPasswordStrength, type FetchLike } from '../src/lib/passwordPolicy';

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');

describe('schemas', () => {
  it('normalises and validates email', () => {
    expect(emailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b').success).toBe(false);
  });

  it('constrains usernames to a safe alphabet', () => {
    expect(usernameSchema.parse(' alice_01.x ')).toBe('alice_01.x');
    for (const bad of ['ab', 'a'.repeat(33), 'al ice', 'alice@x', '.alice', 'alice.', 'al..ice', 'алиса']) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('checks base64 shape and exact decoded length', () => {
    expect(base64Bytes(32).safeParse(b64(32)).success).toBe(true);
    expect(base64Bytes(32).safeParse(b64(31)).success).toBe(false);
    expect(base64Bytes(32).safeParse('A'.repeat(43)).success).toBe(false); // bad padding
    expect(base64Bytes(32).safeParse(b64(32).replace('+', '-')).success).toBe(true); // no '+' in 0x07 bytes; still valid
    expect(base64Bytes(32).safeParse('!!!!').success).toBe(false);
  });

  it('validates signed prekeys and prekey batches', () => {
    expect(signedPreKeySchema.safeParse({ keyId: 1, publicKey: b64(32), signature: b64(64) }).success).toBe(true);
    expect(signedPreKeySchema.safeParse({ keyId: 1.5, publicKey: b64(32), signature: b64(64) }).success).toBe(false);
    expect(signedPreKeySchema.safeParse({ keyId: 1, publicKey: b64(32), signature: b64(32) }).success).toBe(false);

    expect(preKeysUploadSchema.safeParse({ items: [] }).success).toBe(false);
    expect(preKeysUploadSchema.safeParse({ items: [{ keyId: 'x', publicKey: b64(32) }] }).success).toBe(false);
    expect(
      preKeysUploadSchema.safeParse({ items: Array.from({ length: 501 }, (_, i) => ({ keyId: i, publicKey: b64(32) })) }).success,
    ).toBe(false);
  });

  it('reports one message per field', () => {
    const result = registerSchema.safeParse({ email: 'nope', username: 'a', password: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error);
      expect(Object.keys(fields).sort()).toEqual(['email', 'password', 'username']);
      expect(fields.password).toMatch(/at least 10/);
    }
  });
});

describe('checkPasswordStrength', () => {
  it('rejects short, weak, and identifier-derived passwords', () => {
    expect(checkPasswordStrength('short1!').ok).toBe(false);
    expect(checkPasswordStrength('password123').ok).toBe(false);
    expect(checkPasswordStrength('qwertyuiop12').ok).toBe(false);
    // strong on its own, trivial once the user's email is known
    expect(checkPasswordStrength('vahagn.zargaryan1', ['vahagn.zargaryan@example.com']).ok).toBe(false);
  });

  it('accepts a strong passphrase', () => {
    expect(checkPasswordStrength('correct horse battery staple 42').ok).toBe(true);
    expect(checkPasswordStrength('Tq9!vLm#2rXp@8w').ok).toBe(true);
  });
});

describe('breachCount (HIBP k-anonymity)', () => {
  const password = 'password123';
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();

  it('sends only the 5-character prefix and matches the suffix locally', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => `00000000000000000000000000000000000:1\r\n${sha1.slice(5)}:12345\r\n` };
    };
    expect(await breachCount(password, { fetchImpl })).toBe(12345);
    expect(calls).toHaveLength(1);
    expect(calls[0].endsWith(`/range/${sha1.slice(0, 5)}`)).toBe(true);
    expect(calls[0]).not.toContain(sha1.slice(5));
    expect(calls[0]).not.toContain(password);
  });

  it('returns 0 when the suffix is absent', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3\n' });
    expect(await breachCount(password, { fetchImpl })).toBe(0);
  });

  it('fails open on network errors, non-200s, and timeouts', async () => {
    expect(await breachCount(password, { fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
    expect(await breachCount(password, { fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) })).toBeNull();
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await breachCount(password, { fetchImpl: slow, timeoutMs: 20 })).toBeNull();
  });
});

describe('checkPasswordPolicy', () => {
  it('blocks a breached password and lets registration through when HIBP is unreachable', async () => {
    const strong = 'correct horse battery staple 42';
    const sha1 = createHash('sha1').update(strong).digest('hex').toUpperCase();
    const breached: FetchLike = async () => ({ ok: true, status: 200, text: async () => `${sha1.slice(5)}:7\n` });
    expect(await checkPasswordPolicy(strong, { fetchImpl: breached })).toMatchObject({ ok: false, reason: /data breach/ });

    const offline: FetchLike = async () => { throw new Error('offline'); };
    expect(await checkPasswordPolicy(strong, { fetchImpl: offline })).toEqual({ ok: true });
    expect(await checkPasswordPolicy(strong, { breachCheck: false })).toEqual({ ok: true });
  });
});
