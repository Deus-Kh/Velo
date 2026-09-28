import { hkdfSha256 } from '../primitives/kdf';
import { ProtocolError } from '../errors';

/** "WhisperMessageKeys" — Signal's message-key expansion label. Wire constant (R8). */
const INFO_MESSAGE_KEYS = new Uint8Array([87, 104, 105, 115, 112, 101, 114, 77, 101, 115, 115, 97, 103, 101, 75, 101, 121, 115]);

export interface ExpandedMessageKeys {
  cipherKey: Uint8Array; // 32 bytes — secretbox key
  macKey: Uint8Array; // 32 bytes — HMAC-SHA256 key
  nonce: Uint8Array; // 24 bytes — secretbox nonce; its first 16 bytes are Signal's iv
}

/**
 * Expand a 32-byte message key into cipher key, MAC key and nonce:
 *   HKDF-SHA256(ikm = mk, salt = none, info = "WhisperMessageKeys", 88)
 *   → cipherKey[0..32) ‖ macKey[32..64) ‖ nonce[64..88)
 * The first 80 bytes are exactly libsignal's ChainKey::message_keys
 * (cipher key, mac key, 16-byte iv); HKDF expansion is prefix-stable, so
 * the T2.15 vectors apply. The nonce is derived, not transmitted: every
 * message key is used once, so a derived nonce can never repeat under a
 * key (resolves DEVIATION-6).
 */
export function expandMessageKey(messageKey: Uint8Array): ExpandedMessageKeys {
  if (messageKey.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'messageKey must be 32 bytes', { what: 'messageKey', length: messageKey.length });
  }
  const okm = hkdfSha256({ ikm: messageKey, info: INFO_MESSAGE_KEYS, length: 88 });
  return { cipherKey: okm.slice(0, 32), macKey: okm.slice(32, 64), nonce: okm.slice(64, 88) };
}
