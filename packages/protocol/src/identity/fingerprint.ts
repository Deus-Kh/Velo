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

type HalfParams = {
  identifier: Uint8Array;
  identityKey: Uint8Array;
  iterations?: number;
  version?: number;
};

function halfSeed(params: HalfParams): { buf: Uint8Array; iterations: number } {
  const iterations = params.iterations ?? FINGERPRINT_ITERATIONS;
  const version = params.version ?? FINGERPRINT_VERSION;
  const versionBytes = new Uint8Array([(version >>> 8) & 0xff, version & 0xff]);
  return { buf: concat([versionBytes, params.identityKey, params.identifier]), iterations };
}

/** `count` rounds of buf := SHA-512(buf || identityKey). */
function iterate(buf: Uint8Array, identityKey: Uint8Array, count: number): Uint8Array {
  let out = buf;
  for (let i = 0; i < count; i += 1) out = sha512.create().update(out).update(identityKey).digest();
  return out;
}

function digitsOf(buf: Uint8Array): string {
  let out = '';
  for (let offset = 0; offset < 30; offset += 5) out += encodedChunk(buf, offset);
  return out;
}

/** One party's 30-digit half. */
export function fingerprintHalf(params: HalfParams): string {
  const { buf, iterations } = halfSeed(params);
  return digitsOf(iterate(buf, params.identityKey, iterations));
}

/**
 * The same half as a resumable job: `step(rounds)` runs that many SHA-512
 * rounds and returns whether the job is complete; `digits()` is valid once
 * it is. 5200 rounds take seconds in an interpreted JS engine on a phone,
 * and a single synchronous loop would freeze the screen for all of them;
 * a caller that owns an event loop drives the job in slices and yields
 * between them. The package stays synchronous and pure (no timers here).
 * Identical digits to `fingerprintHalf` (the libsignal vectors pin both).
 */
export type FingerprintHalfJob = {
  readonly total: number;
  readonly done: number;
  /** Runs up to `rounds` more rounds; true when the half is complete. */
  step(rounds: number): boolean;
  /** The 30 digits once the job is complete; null before. */
  digits(): string | null;
};

export function fingerprintHalfJob(params: HalfParams): FingerprintHalfJob {
  const { buf: seed, iterations } = halfSeed(params);
  let buf = seed;
  let done = 0;
  return {
    total: iterations,
    get done() {
      return done;
    },
    step(rounds: number): boolean {
      const count = Math.max(0, Math.min(rounds, iterations - done));
      if (count > 0) {
        buf = iterate(buf, params.identityKey, count);
        done += count;
      }
      return done >= iterations;
    },
    digits(): string | null {
      return done < iterations ? null : digitsOf(buf);
    },
  };
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
export type SafetyNumberParams = {
  myUserId: string;
  myIdentity: Identity;
  theirUserId: string;
  theirIdentity: Identity;
};
export type SafetyNumber = { display: string; grouped: string; myHalf: string; theirHalf: string };

const identityKeyBytes = (id: Identity): Uint8Array => concat([decodeBase64(normalizeB64(id.identitySignPublicKey)), decodeBase64(normalizeB64(id.identityDhPublicKey))]);

export function computeSafetyNumber(params: SafetyNumberParams): SafetyNumber {
  const myHalf = fingerprintHalf({ identifier: utf8Encode(params.myUserId), identityKey: identityKeyBytes(params.myIdentity) });
  const theirHalf = fingerprintHalf({ identifier: utf8Encode(params.theirUserId), identityKey: identityKeyBytes(params.theirIdentity) });
  const display = displayableFingerprint(myHalf, theirHalf);
  return { display, grouped: groupDigits(display), myHalf, theirHalf };
}

/** The whole safety number as a resumable job over both halves (`total` = 2 × iterations). */
export type SafetyNumberJob = {
  readonly total: number;
  readonly done: number;
  step(rounds: number): boolean;
  /** The number once both halves are complete; null before. */
  result(): SafetyNumber | null;
};

export function safetyNumberJob(params: SafetyNumberParams): SafetyNumberJob {
  const mine = fingerprintHalfJob({ identifier: utf8Encode(params.myUserId), identityKey: identityKeyBytes(params.myIdentity) });
  const theirs = fingerprintHalfJob({ identifier: utf8Encode(params.theirUserId), identityKey: identityKeyBytes(params.theirIdentity) });
  return {
    total: mine.total + theirs.total,
    get done() {
      return mine.done + theirs.done;
    },
    step(rounds: number): boolean {
      let left = Math.max(0, rounds);
      if (mine.done < mine.total) {
        const before = mine.done;
        mine.step(left);
        left -= mine.done - before;
      }
      if (left > 0 && theirs.done < theirs.total) theirs.step(left);
      return mine.done >= mine.total && theirs.done >= theirs.total;
    },
    result(): SafetyNumber | null {
      const myHalf = mine.digits();
      const theirHalf = theirs.digits();
      if (myHalf === null || theirHalf === null) return null;
      const display = displayableFingerprint(myHalf, theirHalf);
      return { display, grouped: groupDigits(display), myHalf, theirHalf };
    },
  };
}
