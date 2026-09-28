import { sha512 } from '@noble/hashes/sha2.js';
import { decodeBase64 } from 'tweetnacl-util';
import { normalizeB64 } from '../primitives/base64';
import { utf8Encode } from '../primitives/utf8';
import type { Identity } from './binding';

/**
 * Numeric fingerprint, libsignal's construction (NumericFingerprintGenerator):
 *   buf := version(u16 BE) || identityKey || stableIdentifier
 *   repeat `iterations` times: buf := SHA-512(buf || identityKey)
 *   half := six 5-digit chunks, chunk_i = u40BE(buf[5i..5i+5]) mod 100000
 * The displayable fingerprint is the two 30-digit halves, the lexically
 * smaller first, so both parties see the same 60 digits.
 *
 * `identityKey` is whatever bytes identify the party. libsignal feeds its
 * serialized Curve25519 key (0x05 || 32 bytes); the T2.15 vectors pin this
 * function with exactly that input. Velo feeds IK_sign || IK_dh (64 bytes,
 * no type byte) — DEVIATION-5, see computeSafetyNumber.
 */
export const FINGERPRINT_ITERATIONS = 5200;
export const FINGERPRINT_VERSION = 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodedChunk(hash: Uint8Array, offset: number): string {
  // u40 big-endian from five bytes; exact in JS numbers (< 2^53).
  let v = 0;
  for (let i = 0; i < 5; i += 1) v = v * 256 + hash[offset + i]!;
  return String(v % 100000).padStart(5, '0');
}

/** One party's 30-digit half. */
export function fingerprintHalf(params: {
  identifier: Uint8Array;
  identityKey: Uint8Array;
  iterations?: number;
  version?: number;
}): string {
  const iterations = params.iterations ?? FINGERPRINT_ITERATIONS;
  const version = params.version ?? FINGERPRINT_VERSION;
  const versionBytes = new Uint8Array([(version >>> 8) & 0xff, version & 0xff]);
  let buf: Uint8Array = concat([versionBytes, params.identityKey, params.identifier]);
  for (let i = 0; i < iterations; i += 1) {
    buf = sha512(concat([buf, params.identityKey]));
  }
  let out = '';
  for (let offset = 0; offset < 30; offset += 5) out += encodedChunk(buf, offset);
  return out;
}

/** The 60-digit displayable fingerprint: smaller half first. */
export function displayableFingerprint(localHalf: string, remoteHalf: string): string {
  return localHalf < remoteHalf ? localHalf + remoteHalf : remoteHalf + localHalf;
}

/** "12345 67890 …" — twelve groups of five. */
export function groupDigits(display: string): string {
  return display.match(/.{1,5}/g)?.join(' ') ?? display;
}

/**
 * Velo safety number (DEVIATION-5): identityKey = IK_sign || IK_dh, the
 * stable identifier is the user id. Both identity keys are covered, so a
 * substituted DH key changes the number (the P0-9 gap).
 */
export function computeSafetyNumber(params: {
  myUserId: string;
  myIdentity: Identity;
  theirUserId: string;
  theirIdentity: Identity;
}): { display: string; grouped: string; myHalf: string; theirHalf: string } {
  const keyBytes = (id: Identity) => concat([decodeBase64(normalizeB64(id.identitySignPublicKey)), decodeBase64(normalizeB64(id.identityDhPublicKey))]);
  const myHalf = fingerprintHalf({ identifier: utf8Encode(params.myUserId), identityKey: keyBytes(params.myIdentity) });
  const theirHalf = fingerprintHalf({ identifier: utf8Encode(params.theirUserId), identityKey: keyBytes(params.theirIdentity) });
  const display = displayableFingerprint(myHalf, theirHalf);
  return { display, grouped: groupDigits(display), myHalf, theirHalf };
}
