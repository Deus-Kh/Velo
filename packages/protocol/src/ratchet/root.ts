import { hkdfSha256 } from '../primitives/kdf';
import { wipe } from '../primitives/zeroize';

/** "WhisperRatchet" — Signal's KDF_RK info label (libsignal RootKey::create_chain). Wire-format constant (R8). */
const INFO_RK = new Uint8Array([87, 104, 105, 115, 112, 101, 114, 82, 97, 116, 99, 104, 101, 116]);

/**
 * KDF_RK_HE (Double Ratchet with header encryption, T3.6):
 *   (newRootKey, newChainKey, newHeaderKey) = HKDF-SHA256(salt = rootKey, ikm = dhOut, info = "WhisperRatchet", 96)
 * - rootKey is the HKDF salt (domain separation and binding)
 * - dhOut is the input key material
 * HKDF expansion is prefix-stable: the first 64 bytes are exactly Signal's
 * KDF_RK and stay byte-identical to libsignal for the T2.15 vectors; the
 * third block is the next header key (NHK) of the chain being created.
 */
export function kdfRootKey(params: {
  rootKey: Uint8Array; // 32 bytes
  dhOut: Uint8Array;   // 32 bytes
}): { newRootKey: Uint8Array; newChainKey: Uint8Array; newHeaderKey: Uint8Array } {
  // 96 bytes output: 32 root + 32 chain + 32 next header key
  const okm = hkdfSha256({
    ikm: params.dhOut,
    salt: params.rootKey,
    info: INFO_RK,
    length: 96,
  });

  const out = { newRootKey: okm.slice(0, 32), newChainKey: okm.slice(32, 64), newHeaderKey: okm.slice(64, 96) };
  wipe(okm); // T3.4: the block is copied out, the original is zeroed
  return out;
}
