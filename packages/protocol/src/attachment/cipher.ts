import nacl from 'tweetnacl';
import { ProtocolError } from '../errors';
import { hmacSha256, sha256Bytes } from '../primitives/kdf';
import { wipe } from '../primitives/zeroize';
import { ATTACHMENT_CHUNK_BYTES, ATTACHMENT_MAC_BYTES, MAX_ATTACHMENT_BYTES, chunkNonce, expandAttachmentKey } from './keys';

/**
 * Attachment cipher (T8.1). Blob layout:
 *   chunk_0 ‖ chunk_1 ‖ … ‖ chunk_{n-1} ‖ HMAC-SHA256(macKey, chunks)
 * where chunk_i = secretbox(plain[i·64 KiB .. (i+1)·64 KiB), nonce_i, cipherKey)
 * (16-byte tag + data). The message carries SHA-256(blob) as `digest`, so a
 * blob swapped on the server is refused before any key is touched; the MAC
 * trailer is verified before any chunk is opened (nothing is derived from a
 * blob that is not the sender's). Chunking is unambiguous from the length:
 * every chunk but the last is 64 KiB + 16 bytes.
 *
 * Signal seals attachments with AES-256-CBC + HMAC-SHA256 and a SHA-256
 * digest; this is the same shape over secretbox (DEVIATION-10).
 */
const CHUNK_CIPHERTEXT_BYTES = ATTACHMENT_CHUNK_BYTES + nacl.secretbox.overheadLength;

export interface EncryptedAttachment {
  /** What is uploaded: chunks ‖ MAC. */
  blob: Uint8Array;
  /** SHA-256 of `blob`; travels in the message. */
  digest: Uint8Array;
  /** Plaintext length; travels in the message. */
  size: number;
}

export function attachmentEncrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedAttachment {
  if (plaintext.length > MAX_ATTACHMENT_BYTES) {
    throw new ProtocolError('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the size cap', { size: plaintext.length, limit: MAX_ATTACHMENT_BYTES });
  }
  const keys = expandAttachmentKey(key);
  try {
    const chunkCount = Math.max(1, Math.ceil(plaintext.length / ATTACHMENT_CHUNK_BYTES));
    const blob = new Uint8Array(plaintext.length + chunkCount * nacl.secretbox.overheadLength + ATTACHMENT_MAC_BYTES);
    let offset = 0;
    for (let i = 0; i < chunkCount; i += 1) {
      const chunk = plaintext.subarray(i * ATTACHMENT_CHUNK_BYTES, Math.min(plaintext.length, (i + 1) * ATTACHMENT_CHUNK_BYTES));
      const sealed = nacl.secretbox(chunk, chunkNonce(keys.nonceBase, i), keys.cipherKey);
      blob.set(sealed, offset);
      offset += sealed.length;
    }
    const mac = hmacSha256(keys.macKey, blob.subarray(0, offset));
    blob.set(mac, offset);
    return { blob, digest: sha256Bytes(blob), size: plaintext.length };
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonceBase);
  }
}

/**
 * Verifies the digest (when given), then the MAC, then opens every chunk.
 * Throws `ATTACHMENT_DIGEST_MISMATCH`, `ATTACHMENT_MAC_INVALID` or
 * `ATTACHMENT_INVALID` (structure or size); nothing is returned on any failure.
 */
export function attachmentDecrypt(blob: Uint8Array, key: Uint8Array, expected: { digest?: Uint8Array; size?: number } = {}): Uint8Array {
  if (blob.length < ATTACHMENT_MAC_BYTES + nacl.secretbox.overheadLength) {
    throw new ProtocolError('ATTACHMENT_INVALID', 'Attachment blob is too short', { length: blob.length });
  }
  if (blob.length > MAX_ATTACHMENT_BYTES + Math.ceil(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES) * nacl.secretbox.overheadLength + ATTACHMENT_MAC_BYTES) {
    throw new ProtocolError('ATTACHMENT_TOO_LARGE', 'Attachment blob exceeds the size cap', { length: blob.length, limit: MAX_ATTACHMENT_BYTES });
  }
  if (expected.digest) {
    const digest = sha256Bytes(blob);
    if (expected.digest.length !== digest.length || !nacl.verify(digest, expected.digest)) {
      throw new ProtocolError('ATTACHMENT_DIGEST_MISMATCH', 'Attachment blob does not match the digest in the message', { length: blob.length });
    }
  }
  const keys = expandAttachmentKey(key);
  try {
    const body = blob.subarray(0, blob.length - ATTACHMENT_MAC_BYTES);
    const mac = blob.subarray(blob.length - ATTACHMENT_MAC_BYTES);
    const computed = hmacSha256(keys.macKey, body);
    if (!nacl.verify(computed, mac)) {
      throw new ProtocolError('ATTACHMENT_MAC_INVALID', 'Attachment MAC does not verify', { length: blob.length });
    }
    const full = Math.floor(body.length / CHUNK_CIPHERTEXT_BYTES);
    const rest = body.length - full * CHUNK_CIPHERTEXT_BYTES;
    if (rest !== 0 && rest < nacl.secretbox.overheadLength) {
      throw new ProtocolError('ATTACHMENT_INVALID', 'Attachment chunking is malformed', { rest });
    }
    const chunkCount = full + (rest > 0 ? 1 : 0);
    const plainLength = full * ATTACHMENT_CHUNK_BYTES + (rest > 0 ? rest - nacl.secretbox.overheadLength : 0);
    if (expected.size !== undefined && expected.size !== plainLength) {
      throw new ProtocolError('ATTACHMENT_INVALID', 'Attachment size does not match the message', { size: plainLength, expected: expected.size });
    }
    const out = new Uint8Array(plainLength);
    let inOffset = 0;
    let outOffset = 0;
    for (let i = 0; i < chunkCount; i += 1) {
      const len = i < full ? CHUNK_CIPHERTEXT_BYTES : rest;
      const opened = nacl.secretbox.open(body.subarray(inOffset, inOffset + len), chunkNonce(keys.nonceBase, i), keys.cipherKey);
      if (!opened) {
        wipe(out);
        throw new ProtocolError('ATTACHMENT_MAC_INVALID', 'Attachment chunk does not open', { chunk: i });
      }
      out.set(opened, outOffset);
      wipe(opened);
      inOffset += len;
      outOffset += opened.length;
    }
    return out;
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonceBase);
  }
}
