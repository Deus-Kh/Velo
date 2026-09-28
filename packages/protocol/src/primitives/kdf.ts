import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

export function hkdfSha256(params: {
  ikm: Uint8Array;
  salt?: Uint8Array;
  info?: Uint8Array;
  length: number;
}): Uint8Array {
  return hkdf(
    sha256,
    params.ikm,
    params.salt ?? new Uint8Array([]),
    params.info ?? new Uint8Array([]),
    params.length
  );
}
