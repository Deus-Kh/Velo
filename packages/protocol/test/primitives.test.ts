import { describe, expect, it } from 'vitest';
import { encodeBase64 } from 'tweetnacl-util';
import { hkdfSha256, hmacSha256, sha256Bytes } from '../src/primitives/kdf';
import { normalizeB64 } from '../src/primitives/base64';
import { utf8Decode, utf8Encode } from '../src/primitives/utf8';
import { decodeKey, encodeKey } from '../src/primitives/encoding';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('kdf primitives (known-answer)', () => {
  it('sha256("abc") matches FIPS 180-4', () => {
    expect(hex(sha256Bytes(ascii('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('HMAC-SHA256 matches RFC 4231 test case 2', () => {
    expect(hex(hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('HKDF-SHA256 matches RFC 5869 test case 1', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
    const info = new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);
    expect(hex(hkdfSha256({ ikm, salt, info, length: 42 }))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });
});

describe('encoding helpers', () => {
  it('base64 normalisation repairs url-safe alphabet, spaces and padding (current lenient behaviour)', () => {
    expect(normalizeB64('ab-c_d')).toBe('ab+c/d==');
    expect(normalizeB64('ab cd')).toBe('ab+cd===');
    expect(normalizeB64('YWJj')).toBe('YWJj');
  });

  it('key encoding round-trips 32-byte keys', () => {
    const key = new Uint8Array(32).map((_, i) => i * 7);
    expect(decodeKey(encodeKey(key))).toEqual(key);
    expect(encodeKey(key)).toBe(encodeBase64(key));
  });

  it('utf8 round-trips ASCII, Cyrillic and emoji', () => {
    for (const s of ['plain', 'привет', '🙂 emoji', 'mixed текст 🔐']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });
});
