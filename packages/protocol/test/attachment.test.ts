import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { protocolErrorCode } from '../src/errors';
import { decodeContent, encodeContent, isActionContent, isAttachmentContent, isControlContent } from '../src/content/envelope';
import { attachmentDecrypt, attachmentEncrypt } from '../src/attachment/cipher';
import { ATTACHMENT_CHUNK_BYTES, ATTACHMENT_MAC_BYTES, MAX_ATTACHMENT_BYTES, chunkNonce, expandAttachmentKey, generateAttachmentKey } from '../src/attachment/keys';
import { stripImageMetadata } from '../src/attachment/metadata';
import { hmacSha256 } from '../src/primitives/kdf';

/**
 * T8.1 — attachment keys, cipher, metadata stripping and the content kind.
 */
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
};
const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};
const OVERHEAD = nacl.secretbox.overheadLength;

describe('T8.1 attachment keys', () => {
  it('expands a 32-byte key into cipher key, MAC key and nonce base; a chunk nonce differs per index and never repeats', () => {
    const key = generateAttachmentKey();
    expect(key).toHaveLength(32);
    const k = expandAttachmentKey(key);
    expect([k.cipherKey.length, k.macKey.length, k.nonceBase.length]).toEqual([32, 32, 24]);
    expect(expandAttachmentKey(key).cipherKey).toEqual(k.cipherKey); // deterministic
    const n0 = chunkNonce(k.nonceBase, 0);
    const n1 = chunkNonce(k.nonceBase, 1);
    const nBig = chunkNonce(k.nonceBase, 0x01020304);
    expect(n0).toEqual(k.nonceBase);
    expect(n1.slice(0, 20)).toEqual(k.nonceBase.slice(0, 20));
    expect(n1[23]).toBe(k.nonceBase[23]! ^ 1);
    expect(Array.from(nBig.slice(20)).map((b, i) => b ^ k.nonceBase[20 + i]!)).toEqual([1, 2, 3, 4]);
    expect(codeOf(() => expandAttachmentKey(new Uint8Array(31)))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => chunkNonce(k.nonceBase, -1))).toBe('ATTACHMENT_INVALID');
  });
});

describe('T8.1 attachment cipher', () => {
  it('round-trips every chunking edge: empty, one byte, exactly one chunk, one over, several chunks', { timeout: 30_000 }, () => {
    const key = generateAttachmentKey();
    for (const n of [0, 1, ATTACHMENT_CHUNK_BYTES - 1, ATTACHMENT_CHUNK_BYTES, ATTACHMENT_CHUNK_BYTES + 1, 3 * ATTACHMENT_CHUNK_BYTES + 777]) {
      const plain = bytes(n, n + 7);
      const enc = attachmentEncrypt(plain, key);
      const chunks = Math.max(1, Math.ceil(n / ATTACHMENT_CHUNK_BYTES));
      expect(enc.blob.length, `size ${n}`).toBe(n + chunks * OVERHEAD + ATTACHMENT_MAC_BYTES);
      expect(enc.size).toBe(n);
      expect(enc.digest).toHaveLength(32);
      expect(nacl.verify(attachmentDecrypt(enc.blob, key, { digest: enc.digest, size: enc.size }), plain) || n === 0, `size ${n}`).toBe(true);
      expect(nacl.verify(attachmentDecrypt(enc.blob, key), plain) || n === 0).toBe(true); // digest and size are optional checks
    }
  });

  it('the same plaintext under two keys gives unrelated blobs; a fresh encryption under one key is deterministic (derived nonces)', () => {
    const plain = bytes(1000);
    const a = attachmentEncrypt(plain, generateAttachmentKey());
    const b = attachmentEncrypt(plain, generateAttachmentKey());
    expect(a.blob).not.toEqual(b.blob);
    const key = generateAttachmentKey();
    expect(attachmentEncrypt(plain, key).blob).toEqual(attachmentEncrypt(plain, key).blob);
  });

  it('refuses a swapped blob by digest, a flipped byte by MAC, a moved chunk, a truncation and a size mismatch; nothing partial is returned', () => {
    const key = generateAttachmentKey();
    const plain = bytes(2 * ATTACHMENT_CHUNK_BYTES + 5);
    const enc = attachmentEncrypt(plain, key);
    const other = attachmentEncrypt(bytes(2 * ATTACHMENT_CHUNK_BYTES + 5, 99), key);
    expect(codeOf(() => attachmentDecrypt(other.blob, key, { digest: enc.digest }))).toBe('ATTACHMENT_DIGEST_MISMATCH');

    const flipped = new Uint8Array(enc.blob);
    flipped[ATTACHMENT_CHUNK_BYTES + 3] = flipped[ATTACHMENT_CHUNK_BYTES + 3]! ^ 0x01;
    expect(codeOf(() => attachmentDecrypt(flipped, key))).toBe('ATTACHMENT_MAC_INVALID');

    // Re-MAC a blob whose two full chunks are swapped: the trailer passes, the per-chunk nonce does not.
    const swapped = new Uint8Array(enc.blob);
    const c = ATTACHMENT_CHUNK_BYTES + OVERHEAD;
    swapped.set(enc.blob.subarray(c, 2 * c), 0);
    swapped.set(enc.blob.subarray(0, c), c);
    const k = expandAttachmentKey(key);
    swapped.set(hmacSha256(k.macKey, swapped.subarray(0, swapped.length - ATTACHMENT_MAC_BYTES)), swapped.length - ATTACHMENT_MAC_BYTES);
    expect(codeOf(() => attachmentDecrypt(swapped, key))).toBe('ATTACHMENT_MAC_INVALID');

    expect(codeOf(() => attachmentDecrypt(enc.blob.subarray(0, enc.blob.length - 1), key))).toBe('ATTACHMENT_MAC_INVALID');
    expect(codeOf(() => attachmentDecrypt(new Uint8Array(10), key))).toBe('ATTACHMENT_INVALID');
    expect(codeOf(() => attachmentDecrypt(enc.blob, key, { size: plain.length + 1 }))).toBe('ATTACHMENT_INVALID');
    expect(codeOf(() => attachmentDecrypt(enc.blob, generateAttachmentKey()))).toBe('ATTACHMENT_MAC_INVALID'); // wrong key: MAC first, nothing opened
    expect(codeOf(() => attachmentEncrypt(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), key))).toBe('ATTACHMENT_TOO_LARGE');
  });
});

describe('T8.1 metadata stripping', () => {
  const seg = (marker: number, payload: number[]): number[] => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  it('JPEG: APP1 (Exif), IPTC and comments go; JFIF, ICC, Adobe, tables and the scan stay byte-for-byte', () => {
    const exif = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);
    const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
    const icc = seg(0xe2, [0x49, 0x43, 0x43, 0x5f, 7]);
    const iptc = seg(0xed, [1, 2, 3]);
    const adobe = seg(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65]);
    const comment = seg(0xfe, [0x68, 0x69]);
    const dqt = seg(0xdb, [0, 1, 2, 3]);
    const scan = [0xff, 0xda, 0, 4, 1, 0, 0xaa, 0xbb, 0xff, 0x00, 0xcc, 0xff, 0xd9];
    const jpeg = new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...icc, ...iptc, ...adobe, ...comment, ...dqt, ...scan]);
    const r = stripImageMetadata(jpeg);
    expect(r.kind).toBe('jpeg');
    expect(r.removed).toBe(3);
    expect(Array.from(r.bytes)).toEqual([0xff, 0xd8, ...jfif, ...icc, ...adobe, ...dqt, ...scan]);
    // Idempotent, and a clean file is returned as is.
    expect(stripImageMetadata(r.bytes).removed).toBe(0);
    expect(stripImageMetadata(r.bytes).bytes).toBe(r.bytes);
    // Malformed (a segment claims to run past the end): untouched.
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]);
    expect(stripImageMetadata(bad).bytes).toBe(bad);
  });

  it('PNG: text, time and eXIf chunks go; header, data and end stay', () => {
    const chunk = (type: string, data: number[]): number[] => [0, 0, 0, data.length, ...type.split('').map((ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const text = chunk('tEXt', [0x41, 0, 0x42]);
    const exif = chunk('eXIf', [1, 2, 3]);
    const time = chunk('tIME', [7, 230, 1, 1, 0, 0, 0]);
    const idat = chunk('IDAT', [1, 2, 3, 4]);
    const itxt = chunk('iTXt', [0x41, 0, 0, 0, 0, 0, 0x42]);
    const iend = chunk('IEND', []);
    const png = new Uint8Array([...sig, ...ihdr, ...text, ...exif, ...idat, ...time, ...itxt, ...iend]);
    const r = stripImageMetadata(png);
    expect(r.kind).toBe('png');
    expect(r.removed).toBe(4);
    expect(Array.from(r.bytes)).toEqual([...sig, ...ihdr, ...idat, ...iend]);
    const other = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stripImageMetadata(other)).toEqual({ bytes: other, removed: 0, kind: 'other' });
  });
});

describe('T8.1 attachment content', () => {
  const key = encodeBase64(bytes(32, 3));
  const digest = encodeBase64(bytes(32, 4));
  it('round-trips with and without the optional fields; it is a message, neither control nor action', () => {
    const full = { v: 1, kind: 'attachment', blobId: 'b'.repeat(32), key, digest, size: 12_345, contentType: 'image/jpeg', name: 'photo.jpg', width: 1600, height: 900, caption: 'look' } as const;
    const dec = decodeContent(encodeContent(full));
    expect(dec).toEqual(full);
    expect(isAttachmentContent(dec)).toBe(true);
    expect(isActionContent(dec)).toBe(false);
    expect(isControlContent(dec)).toBe(false);
    const min = { v: 1, kind: 'attachment', blobId: 'x', key, digest, size: 0, contentType: 'Audio/MP4', durationMs: 4200 } as const;
    expect(decodeContent(encodeContent(min))).toEqual({ ...min, contentType: 'audio/mp4' });
  });

  it('malformed attachments are typed refusals: bad key or digest length, bad size, bad type, oversized optional fields', () => {
    const base = `"v":1,"kind":"attachment","blobId":"b","key":"${key}","digest":"${digest}","size":10,"contentType":"image/png"`;
    const bad = [
      base.replace(`"key":"${key}"`, `"key":"${encodeBase64(bytes(31))}"`),
      base.replace(`"digest":"${digest}"`, `"digest":"nope"`),
      base.replace('"size":10', '"size":-1'),
      base.replace('"size":10', `"size":${MAX_ATTACHMENT_BYTES + 1}`),
      base.replace('"size":10', '"size":1.5'),
      base.replace('"contentType":"image/png"', '"contentType":"image"'),
      base.replace('"blobId":"b"', '"blobId":""'),
      base + ',"width":-1',
      base + ',"width":99999',
      base + ',"caption":"' + 'c'.repeat(4001) + '"',
      base + ',"durationMs":"long"',
    ];
    for (const b of bad) expect(codeOf(() => decodeContent('{' + b + '}')), b.slice(0, 60)).toBe('STORAGE_CORRUPTION');
    expect(() => encodeContent({ v: 1, kind: 'attachment', blobId: 'b', key: 'short', digest, size: 1, contentType: 'image/png' })).toThrow();
  });
});

describe('T8.1 frozen vector', () => {
  it('a fixed key and plaintext give a fixed blob (derived nonces) and digest; a change here is a wire change (R8)', () => {
    const key = bytes(32, 0xa11ce);
    const plain = bytes(ATTACHMENT_CHUNK_BYTES + 100, 0xb0b);
    const enc = attachmentEncrypt(plain, key);
    const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(enc.blob.length).toBe(ATTACHMENT_CHUNK_BYTES + 100 + 2 * OVERHEAD + ATTACHMENT_MAC_BYTES);
    expect({ digest: hex(enc.digest), head: hex(enc.blob.subarray(0, 16)), mac: hex(enc.blob.subarray(enc.blob.length - 32)), nonceBase: hex(expandAttachmentKey(key).nonceBase) }).toEqual({
      digest: 'acdf67d2f1618d41dc8d8cda7d1585226a47c2d8d2fd6b882d0324113ea51fde',
      head: 'a7481b2cfdf21f31efa69a9d008ebdf6',
      mac: '48ee6bd4ba66e693360afebe547e148ab0552d674002c282914958a4096dbde7',
      nonceBase: '2b3a598417d6d1b92ba1040f574439d58122d2d70e7ba7ce',
    });
  });
});
