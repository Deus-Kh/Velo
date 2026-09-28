import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { hmacSha256 } from '../primitives/kdf';
import { utf8Decode, utf8Encode } from '../primitives/utf8';
import { wipe } from '../primitives/zeroize';
import { canonicalHeaderBytes, WIRE_VERSION, type MessageHeader } from './header';
import { expandMessageKey } from './messageKeys';

/** Wire envelope, version 3: `{header, ciphertext, mac}`. No nonce on the wire (derived). */
export type MessageEnvelope = {
  header: MessageHeader;
  ciphertext: string; // base64 secretbox output
  mac: string; // base64, MAC_LENGTH bytes
};

/** Identity keys that bind a message to its sender/receiver pair (spec T2.5, T2.13 step 6). */
export type AssociatedData = {
  senderIdentityKey: string; // base64 Ed25519 IK_sign of the sender
  receiverIdentityKey: string; // base64 Ed25519 IK_sign of the receiver
};

/** 128-bit tag. Signal truncates its HMAC to 8 bytes for bandwidth; we keep an AEAD-sized tag. */
export const MAC_LENGTH = 16;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function identityBytes(b64: string, what: string): Uint8Array {
  const bytes = decodeBase64(normalizeB64(b64));
  if (bytes.length !== 32) throw new ProtocolError('INVALID_KEY_LENGTH', what + ' must be 32 bytes', { what, length: bytes.length });
  return bytes;
}

/**
 * Authenticated data bytes: IK_sign_sender ‖ IK_sign_receiver ‖ canonicalHeader.
 * Exported so the T2.5 acceptance test can pin the layout.
 */
export function associatedDataBytes(ad: AssociatedData, header: MessageHeader, version: number = WIRE_VERSION): Uint8Array {
  return concat([
    identityBytes(ad.senderIdentityKey, 'senderIdentityKey'),
    identityBytes(ad.receiverIdentityKey, 'receiverIdentityKey'),
    canonicalHeaderBytes(header, version),
  ]);
}

function computeMac(macKey: Uint8Array, adBytes: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return hmacSha256(macKey, concat([adBytes, ciphertext])).slice(0, MAC_LENGTH);
}

/**
 * Encrypt-then-MAC, Signal's envelope shape (D3 = C, no new primitives):
 *   (cipherKey, macKey, nonce) := expandMessageKey(mk)
 *   ciphertext := secretbox(plaintext, nonce, cipherKey)
 *   mac := HMAC-SHA256(macKey, AD ‖ ciphertext)[0..16)
 * T3.4: consumes `messageKey` — the caller's buffer and every expanded key
 * are zeroed before this returns.
 */
export function sealMessage(params: { messageKey: Uint8Array; header: MessageHeader; plaintext: string; ad: AssociatedData }): MessageEnvelope {
  const keys = expandMessageKey(params.messageKey);
  wipe(params.messageKey);
  try {
    const adBytes = associatedDataBytes(params.ad, params.header);
    const ciphertext = nacl.secretbox(utf8Encode(params.plaintext), keys.nonce, keys.cipherKey);
    const mac = computeMac(keys.macKey, adBytes, ciphertext);
    return { header: params.header, ciphertext: encodeBase64(ciphertext), mac: encodeBase64(mac) };
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonce);
  }
}

/**
 * Verify the MAC, then decrypt. Nothing is returned on a bad MAC. The error
 * code tells the two failure classes apart for diagnostics only: if the
 * payload itself opens under the derived key (secretbox's own Poly1305 tag
 * verifies) the header or identities were modified → HEADER_TAMPERED;
 * otherwise the ciphertext is not decryptable under this key →
 * DECRYPT_FAILED. A tampered `dhPub` or `n` changes which key is derived,
 * so it lands in the second class; a tampered `pn` or a re-attributed
 * sender/receiver lands in the first.
 * T3.4: consumes `messageKey`; the expanded keys and the plaintext bytes
 * are zeroed before this returns, on success and on failure.
 */
export function openMessage(params: { messageKey: Uint8Array; envelope: MessageEnvelope; ad: AssociatedData }): string {
  const { envelope } = params;
  const keys = expandMessageKey(params.messageKey);
  wipe(params.messageKey);
  let plain: Uint8Array | null = null;
  try {
    const adBytes = associatedDataBytes(params.ad, envelope.header);
    const ciphertext = decodeBase64(normalizeB64(envelope.ciphertext));
    let mac: Uint8Array;
    try {
      mac = decodeBase64(normalizeB64(envelope.mac ?? ''));
    } catch {
      mac = new Uint8Array(0);
    }

    const expected = computeMac(keys.macKey, adBytes, ciphertext);
    const macOk = mac.length === MAC_LENGTH && nacl.verify(mac, expected);
    plain = nacl.secretbox.open(ciphertext, keys.nonce, keys.cipherKey);

    if (!macOk) {
      if (plain) {
        throw new ProtocolError('HEADER_TAMPERED', 'Message authentication failed: header or identities modified', {
          n: envelope.header.n,
          pn: envelope.header.pn,
        });
      }
      throw new ProtocolError('DECRYPT_FAILED', 'Message authentication failed', { n: envelope.header.n, pn: envelope.header.pn });
    }
    if (!plain) {
      // MAC verified but secretbox did not open: cannot happen with an intact ciphertext.
      throw new ProtocolError('DECRYPT_FAILED', 'secretbox.open failed', { n: envelope.header.n, pn: envelope.header.pn });
    }
    return utf8Decode(plain);
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonce, plain);
  }
}

/** LEGACY (pre-T2.14 archive migration only): open an envelope with a stored message key. */
export function decryptWithMessageKey(params: { messageKeyB64: string; envelope: MessageEnvelope; ad: AssociatedData }): string {
  const mk = decodeBase64(normalizeB64(params.messageKeyB64));
  return openMessage({ messageKey: mk, envelope: params.envelope, ad: params.ad });
}
