import nacl from 'tweetnacl';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';

/**
 * Sealing helpers for values persisted in AsyncStorage (T1.3).
 *
 * `sealJson` / `openJson`: XSalsa20-Poly1305 (`nacl.secretbox`) under a
 * Keychain-held master key. JSON is fine here — the value is storage-only and
 * never hashed, signed or compared across engines (spec rule R4 applies to
 * authenticated wire data, not to a sealed local blob).
 *
 * `macJson` / `verifyMacJson`: HMAC-SHA256 over a domain-separated canonical
 * encoding, for values that need integrity but not secrecy (trust pins).
 */

export interface SealedBlob {
  v: 1;
  nonce: string; // base64, 24 bytes
  ciphertext: string; // base64
}

export function isSealedBlob(value: unknown): value is SealedBlob {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as SealedBlob).v === 1 &&
    typeof (value as SealedBlob).nonce === 'string' &&
    typeof (value as SealedBlob).ciphertext === 'string'
  );
}

export function sealJson(masterKey: Uint8Array, value: unknown): string {
  if (masterKey.length !== nacl.secretbox.keyLength) throw new Error('sealJson: bad key length');
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plain = decodeUTF8(JSON.stringify(value));
  const cipher = nacl.secretbox(plain, nonce, masterKey);
  const blob: SealedBlob = { v: 1, nonce: encodeBase64(nonce), ciphertext: encodeBase64(cipher) };
  return JSON.stringify(blob);
}

/** Returns the parsed value, or `null` for anything that is not a valid blob under this key. */
export function openJson<T = unknown>(masterKey: Uint8Array, raw: string | null): T | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isSealedBlob(parsed)) return null;
  try {
    const nonce = decodeBase64(parsed.nonce);
    const cipher = decodeBase64(parsed.ciphertext);
    if (nonce.length !== nacl.secretbox.nonceLength) return null;
    const plain = nacl.secretbox.open(cipher, nonce, masterKey);
    if (!plain) return null;
    return JSON.parse(encodeUTF8(plain)) as T;
  } catch {
    return null;
  }
}

/** True when `raw` parses as a sealed blob (regardless of key). */
export function looksSealed(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return isSealedBlob(JSON.parse(raw));
  } catch {
    return false;
  }
}

function canonical(domain: string, parts: string[]): Uint8Array {
  // Length-prefixed, fixed order: unambiguous regardless of part contents.
  const chunks: Uint8Array[] = [];
  for (const s of [domain, ...parts]) {
    const bytes = decodeUTF8(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, false);
    chunks.push(len, bytes);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function macFor(masterKey: Uint8Array, domain: string, parts: string[]): string {
  return encodeBase64(hmac(sha256, masterKey, canonical(domain, parts)));
}

export function verifyMac(masterKey: Uint8Array, domain: string, parts: string[], macB64: string): boolean {
  try {
    const expected = hmac(sha256, masterKey, canonical(domain, parts));
    const given = decodeBase64(macB64);
    return given.length === expected.length && nacl.verify(given, expected);
  } catch {
    return false;
  }
}
