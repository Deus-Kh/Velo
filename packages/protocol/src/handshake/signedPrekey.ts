import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { utf8Encode } from '../primitives/utf8';

/**
 * Signed prekeys (spec T2.10, P1-6).
 *
 * The signature covers a domain tag, the key id and the public key, so a
 * signature made for one key id cannot be replayed onto another key (wire
 * v3 change). A signed prekey rotates after ROTATE_AFTER_MS; previous ones
 * are retained for RETAIN_MS so an initPacket built from an older bundle
 * still completes, and are refused after that with a typed error.
 * Sessions copy the pair they were created with (T2.0), so rotation never
 * affects an existing session.
 */
export const SIGNED_PREKEY_DOMAIN = 'velo-signed-prekey-v1';
export const SIGNED_PREKEY_ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const SIGNED_PREKEY_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignedPreKeyRecord {
  keyId: number;
  publicKey: string; // base64 X25519
  privateKey: string; // base64 X25519 secret
  signature: string; // base64 Ed25519 detached signature over the tagged message
  createdAt: number; // ms since epoch
}

/** What a client stores: the current signed prekey and the retained previous ones, newest first. */
export interface SignedPreKeySet {
  v: 2;
  current: SignedPreKeyRecord;
  previous: SignedPreKeyRecord[];
}

/** domain ‖ u32be keyId ‖ publicKey — the bytes the identity signing key signs. */
export function signedPreKeyMessage(keyId: number, publicKey: string): Uint8Array {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0xffffffff) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'signed prekey id must be a u32', { what: 'signedPreKeyId', value: String(keyId) });
  }
  const pub = decodeBase64(normalizeB64(publicKey));
  if (pub.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'signedPreKey.publicKey must be 32 bytes', { what: 'signedPreKey.publicKey', length: pub.length });
  }
  const domain = utf8Encode(SIGNED_PREKEY_DOMAIN);
  const out = new Uint8Array(domain.length + 4 + pub.length);
  out.set(domain, 0);
  new DataView(out.buffer).setUint32(domain.length, keyId, false);
  out.set(pub, domain.length + 4);
  return out;
}

export function signSignedPreKey(identitySignSecretKey: Uint8Array, keyId: number, publicKey: string): string {
  if (identitySignSecretKey.length !== 64) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'identitySignSecretKey must be 64 bytes', { what: 'identitySignSecretKey', length: identitySignSecretKey.length });
  }
  return encodeBase64(nacl.sign.detached(signedPreKeyMessage(keyId, publicKey), identitySignSecretKey));
}

/** True when the signature is by `identitySignPublicKey` over the tagged (keyId, publicKey). */
export function verifySignedPreKey(params: { identitySignPublicKey: string; keyId: number; publicKey: string; signature: string }): boolean {
  const identityPk = decodeBase64(normalizeB64(params.identitySignPublicKey));
  let sig: Uint8Array;
  try {
    sig = decodeBase64(normalizeB64(params.signature ?? ''));
  } catch {
    return false;
  }
  if (identityPk.length !== 32 || sig.length !== 64) return false;
  return nacl.sign.detached.verify(signedPreKeyMessage(params.keyId, params.publicKey), sig, identityPk);
}

/** Rotation is due when the current key is ROTATE_AFTER_MS old (or older). */
export function shouldRotateSignedPreKey(createdAt: number, now: number): boolean {
  return now - createdAt >= SIGNED_PREKEY_ROTATE_AFTER_MS;
}

export function isSignedPreKeyExpired(createdAt: number, now: number): boolean {
  return now - createdAt >= SIGNED_PREKEY_RETAIN_MS;
}

/**
 * Pure rotation step: returns the set to store after `ensureSignedPreKey`
 * at time `now`. A missing or legacy set (pre-T2.10 format) gets a fresh
 * key. Otherwise the current key is kept until it is ROTATE_AFTER_MS old,
 * then moved to `previous` (newest first) and a fresh one generated.
 * Expired previous keys are dropped.
 */
export function rotateSignedPreKeySet(
  set: SignedPreKeySet | null,
  now: number,
  generate: (now: number) => SignedPreKeyRecord,
): { set: SignedPreKeySet; rotated: boolean } {
  if (!set || set.v !== 2 || !set.current) {
    return { set: { v: 2, current: generate(now), previous: [] }, rotated: true };
  }
  const previous = set.previous.filter((p) => !isSignedPreKeyExpired(p.createdAt, now));
  if (!shouldRotateSignedPreKey(set.current.createdAt, now)) {
    return { set: { v: 2, current: set.current, previous }, rotated: false };
  }
  const retired = isSignedPreKeyExpired(set.current.createdAt, now) ? previous : [set.current, ...previous];
  return { set: { v: 2, current: generate(now), previous: retired }, rotated: true };
}

/**
 * The responder's lookup for an initPacket's `signedPreKeyId`: the current
 * or a retained key, refused with SESSION_RESET_REQUIRED when unknown or
 * older than RETAIN_MS.
 */
export function selectSignedPreKey(set: SignedPreKeySet | null, keyId: number, now: number): SignedPreKeyRecord {
  const candidates = set ? [set.current, ...set.previous] : [];
  const found = candidates.find((k) => k.keyId === keyId);
  if (!found) {
    throw new ProtocolError('SESSION_RESET_REQUIRED', 'Signed prekey for this bootstrap is not known on this device', { signedPreKeyId: keyId });
  }
  if (isSignedPreKeyExpired(found.createdAt, now)) {
    throw new ProtocolError('SESSION_RESET_REQUIRED', 'Signed prekey for this bootstrap has expired', {
      signedPreKeyId: keyId,
      ageDays: Math.floor((now - found.createdAt) / (24 * 60 * 60 * 1000)),
    });
  }
  return found;
}
