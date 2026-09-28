import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { wipe } from '../primitives/zeroize';

/** Message header (the plaintext the sender seals under its header key). */
export type MessageHeader = {
  n: number;
  pn: number;
  dhPub: string; // base64 X25519 ratchet public key
};

/** Wire version this package speaks (spec §8.2). v4 = header encryption (T3.6). */
export const WIRE_VERSION = 4;

/** Encrypted header on the wire: 24-byte nonce ‖ secretbox(canonicalHeader). */
export const HEADER_NONCE_LENGTH = nacl.secretbox.nonceLength; // 24
const CANONICAL_HEADER_LENGTH = 1 + 4 + 32 + 4 + 4;
/** Fixed size of an encrypted header: nonce ‖ Poly1305 tag ‖ canonical header. */
export const ENCRYPTED_HEADER_LENGTH = HEADER_NONCE_LENGTH + nacl.secretbox.overheadLength + CANONICAL_HEADER_LENGTH;

const U32_MAX = 0xffffffff;

function writeU32(view: DataView, offset: number, value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new ProtocolError('HEADER_TAMPERED', 'Header field out of range', { what, value: String(value) });
  }
  view.setUint32(offset, value, false);
}

/**
 * Canonical header bytes (R4: explicit length-prefixed serialization, never JSON):
 *   u8 version | u32be dhPubLen | dhPub | u32be n | u32be pn
 * Byte-identical for equal headers regardless of base64 padding or field
 * order. Since T3.6 this is what gets encrypted under the header key.
 */
export function canonicalHeaderBytes(header: MessageHeader, version: number = WIRE_VERSION): Uint8Array {
  const dhPub = decodeBase64(normalizeB64(header.dhPub));
  if (dhPub.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'header.dhPub must be 32 bytes', { what: 'header.dhPub', length: dhPub.length });
  }
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new ProtocolError('HEADER_TAMPERED', 'Unsupported wire version', { what: 'version', value: String(version) });
  }
  const out = new Uint8Array(1 + 4 + dhPub.length + 4 + 4);
  const view = new DataView(out.buffer);
  out[0] = version;
  view.setUint32(1, dhPub.length, false);
  out.set(dhPub, 5);
  writeU32(view, 5 + dhPub.length, header.n, 'header.n');
  writeU32(view, 9 + dhPub.length, header.pn, 'header.pn');
  return out;
}

/** Inverse of canonicalHeaderBytes; used by openHeader and by tests to prove the encoding round-trips. */
export function decodeCanonicalHeader(bytes: Uint8Array): { version: number; header: MessageHeader } {
  if (bytes.length < 13) throw new ProtocolError('HEADER_TAMPERED', 'Canonical header too short', { length: bytes.length });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0]!;
  const dhLen = view.getUint32(1, false);
  if (bytes.length !== 1 + 4 + dhLen + 8) throw new ProtocolError('HEADER_TAMPERED', 'Canonical header length mismatch', { length: bytes.length, dhLen });
  const dhPub = encodeBase64(bytes.slice(5, 5 + dhLen));
  const n = view.getUint32(5 + dhLen, false);
  const pn = view.getUint32(9 + dhLen, false);
  return { version, header: { n, pn, dhPub } };
}

/**
 * HENCRYPT (Double Ratchet §4, T3.6): the header is sealed under the
 * sender's current header key with a random nonce (the key is reused for a
 * whole epoch, so the nonce must be fresh per message and travels with the
 * header). Returns base64(nonce ‖ secretbox(canonicalHeader)). Consumes
 * (wipes) `headerKey`. `nonce` is injectable for frozen-vector tests only.
 */
export function sealHeader(params: { headerKey: Uint8Array; header: MessageHeader; nonce?: Uint8Array }): string {
  if (params.headerKey.length !== 32) {
    wipe(params.headerKey);
    throw new ProtocolError('INVALID_KEY_LENGTH', 'headerKey must be 32 bytes', { what: 'headerKey', length: params.headerKey.length });
  }
  const nonce = params.nonce ?? nacl.randomBytes(HEADER_NONCE_LENGTH);
  if (nonce.length !== HEADER_NONCE_LENGTH) {
    wipe(params.headerKey);
    throw new ProtocolError('INVALID_KEY_LENGTH', 'header nonce must be 24 bytes', { what: 'headerNonce', length: nonce.length });
  }
  try {
    const plain = canonicalHeaderBytes(params.header);
    const box = nacl.secretbox(plain, nonce, params.headerKey);
    const out = new Uint8Array(nonce.length + box.length);
    out.set(nonce, 0);
    out.set(box, nonce.length);
    return encodeBase64(out);
  } finally {
    wipe(params.headerKey);
  }
}

/** Raw bytes of an encrypted header (what the message MAC covers). Throws HEADER_TAMPERED on a malformed field. */
export function encryptedHeaderBytes(encHeaderB64: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(normalizeB64(encHeaderB64 ?? ''));
  } catch {
    throw new ProtocolError('HEADER_TAMPERED', 'Encrypted header is not base64', { what: 'encHeader' });
  }
  if (bytes.length !== ENCRYPTED_HEADER_LENGTH) {
    throw new ProtocolError('HEADER_TAMPERED', 'Encrypted header has the wrong length', { what: 'encHeader', length: bytes.length, expected: ENCRYPTED_HEADER_LENGTH });
  }
  return bytes;
}

/**
 * HDECRYPT: open an encrypted header under one header key. Returns null when
 * it does not open (wrong key, modified bytes) or decodes to something that
 * is not a v4 header. Consumes (wipes) `headerKey`.
 */
export function openHeader(params: { headerKey: Uint8Array; encHeader: string }): MessageHeader | null {
  try {
    if (params.headerKey.length !== 32) return null;
    const bytes = encryptedHeaderBytes(params.encHeader);
    const nonce = bytes.subarray(0, HEADER_NONCE_LENGTH);
    const box = bytes.subarray(HEADER_NONCE_LENGTH);
    const plain = nacl.secretbox.open(box, nonce, params.headerKey);
    if (!plain) return null;
    try {
      const decoded = decodeCanonicalHeader(plain);
      if (decoded.version !== WIRE_VERSION) return null;
      return decoded.header;
    } finally {
      wipe(plain);
    }
  } catch {
    return null;
  } finally {
    wipe(params.headerKey);
  }
}
