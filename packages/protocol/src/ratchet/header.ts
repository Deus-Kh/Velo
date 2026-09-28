import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';

/** Wire header of a message (unchanged shape since v2). */
export type MessageHeader = {
  n: number;
  pn: number;
  dhPub: string; // base64 X25519 ratchet public key
};

/** Wire version this package speaks (spec §8.2). */
export const WIRE_VERSION = 3;

const U32_MAX = 0xffffffff;

function writeU32(view: DataView, offset: number, value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new ProtocolError('HEADER_TAMPERED', 'Header field out of range', { what, value: String(value) });
  }
  view.setUint32(offset, value, false);
}

/**
 * Canonical header bytes for authentication (R4: explicit length-prefixed
 * serialization, never JSON):
 *   u8 version | u32be dhPubLen | dhPub | u32be n | u32be pn
 * Byte-identical for equal headers regardless of base64 padding or field
 * order in the JSON envelope.
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

/** Inverse of canonicalHeaderBytes; used by tests to prove the encoding round-trips. */
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
