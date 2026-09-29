import nacl from 'tweetnacl';
import { ProtocolError } from '../errors';
import { hkdfSha256 } from '../primitives/kdf';
import { wipe } from '../primitives/zeroize';

/**
 * Attachment keys (Phase 8', T8.1). One random 32-byte key per attachment
 * travels inside the E2EE message (`{kind:'attachment'}`); the blob on the
 * server is opaque. The key expands like a message key:
 *   HKDF-SHA256(ikm = key, salt = none, info = "VeloAttachmentKeys", 88)
 *   → cipherKey[0..32) ‖ macKey[32..64) ‖ nonceBase[64..88)
 * Chunk i is sealed under nonceBase with its last four bytes XOR i, so no
 * nonce repeats under a key and a chunk cannot be moved to another index.
 */
export const ATTACHMENT_KEY_BYTES = 32;
export const ATTACHMENT_CHUNK_BYTES = 64 * 1024;
/** Plaintext cap (T8.3 keeps decrypted media on the device; D7 = A). */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MAC_BYTES = 32;

/** "VeloAttachmentKeys" — attachment key expansion label. Wire constant (R8). */
const INFO_ATTACHMENT_KEYS = new Uint8Array([86, 101, 108, 111, 65, 116, 116, 97, 99, 104, 109, 101, 110, 116, 75, 101, 121, 115]);

export interface ExpandedAttachmentKeys {
  cipherKey: Uint8Array; // 32 bytes — secretbox key
  macKey: Uint8Array; // 32 bytes — HMAC-SHA256 over the whole ciphertext
  nonceBase: Uint8Array; // 24 bytes — per-chunk nonce base
}

export function generateAttachmentKey(): Uint8Array {
  return nacl.randomBytes(ATTACHMENT_KEY_BYTES);
}

export function expandAttachmentKey(key: Uint8Array): ExpandedAttachmentKeys {
  if (key.length !== ATTACHMENT_KEY_BYTES) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'attachment key must be 32 bytes', { what: 'attachmentKey', length: key.length });
  }
  const okm = hkdfSha256({ ikm: key, info: INFO_ATTACHMENT_KEYS, length: 88 });
  const out = { cipherKey: okm.slice(0, 32), macKey: okm.slice(32, 64), nonceBase: okm.slice(64, 88) };
  wipe(okm);
  return out;
}

/** The nonce of chunk `index`: the base with its last four bytes XOR the big-endian index. */
export function chunkNonce(nonceBase: Uint8Array, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new ProtocolError('ATTACHMENT_INVALID', 'chunk index out of range', { what: 'chunkIndex', value: String(index) });
  }
  const nonce = new Uint8Array(nonceBase);
  nonce[20] = (nonce[20]! ^ (index >>> 24)) & 0xff;
  nonce[21] = (nonce[21]! ^ (index >>> 16)) & 0xff;
  nonce[22] = (nonce[22]! ^ (index >>> 8)) & 0xff;
  nonce[23] = (nonce[23]! ^ index) & 0xff;
  return nonce;
}
