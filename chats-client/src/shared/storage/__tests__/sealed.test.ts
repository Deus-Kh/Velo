import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { isSealedBlob, looksSealed, macFor, openJson, sealJson, verifyMac } from '../sealed';

const key = () => nacl.randomBytes(32);

describe('sealJson / openJson', () => {
  it('round-trips arbitrary JSON values', () => {
    const mk = key();
    for (const value of ['secret', 42, null, { a: [1, 2, { b: 'c' }], unicode: 'привет 🙂' }, []]) {
      expect(openJson(mk, sealJson(mk, value))).toEqual(value);
    }
  });

  it('produces a blob with a fresh nonce every time and no plaintext inside', () => {
    const mk = key();
    const a = sealJson(mk, { rootKey: 'ROOTKEY-PLAINTEXT' });
    const b = sealJson(mk, { rootKey: 'ROOTKEY-PLAINTEXT' });
    expect(a).not.toBe(b);
    expect(a).not.toContain('ROOTKEY');
    expect(isSealedBlob(JSON.parse(a))).toBe(true);
    expect(looksSealed(a)).toBe(true);
  });

  it('returns null for the wrong key, a tampered ciphertext, or garbage', () => {
    const mk = key();
    const sealed = sealJson(mk, { x: 1 });
    expect(openJson(key(), sealed)).toBeNull();

    const blob = JSON.parse(sealed);
    const bytes = decodeBase64(blob.ciphertext);
    bytes[0] ^= 0x01;
    blob.ciphertext = encodeBase64(bytes);
    expect(openJson(mk, JSON.stringify(blob))).toBeNull();

    expect(openJson(mk, 'not json')).toBeNull();
    expect(openJson(mk, JSON.stringify({ v: 2, nonce: 'x', ciphertext: 'y' }))).toBeNull();
    expect(openJson(mk, null)).toBeNull();
    expect(looksSealed('{"rootKey":"plain"}')).toBe(false);
  });

  it('refuses a key of the wrong length', () => {
    expect(() => sealJson(nacl.randomBytes(16), 'x')).toThrow(/bad key length/);
  });
});

describe('macFor / verifyMac', () => {
  it('verifies the exact domain and parts only', () => {
    const mk = key();
    const mac = macFor(mk, 'trust-v1', ['me', 'peer', 'KEY']);
    expect(verifyMac(mk, 'trust-v1', ['me', 'peer', 'KEY'], mac)).toBe(true);
    expect(verifyMac(mk, 'trust-v1', ['me', 'peer', 'KEX'], mac)).toBe(false);
    expect(verifyMac(mk, 'trust-v1', ['peer', 'me', 'KEY'], mac)).toBe(false);
    expect(verifyMac(mk, 'other-domain', ['me', 'peer', 'KEY'], mac)).toBe(false);
    expect(verifyMac(key(), 'trust-v1', ['me', 'peer', 'KEY'], mac)).toBe(false);
    expect(verifyMac(mk, 'trust-v1', ['me', 'peer', 'KEY'], 'not-base64!!')).toBe(false);
  });

  it('is length-prefixed, so shifting bytes between parts changes the MAC', () => {
    const mk = key();
    expect(macFor(mk, 'd', ['ab', 'c'])).not.toBe(macFor(mk, 'd', ['a', 'bc']));
  });
});
