import { hkdfSha256 } from './kdf';

const INFO_RK = new Uint8Array([114, 107, 45, 118, 49]); // "rk-v1"

/**
 * KDF_RK: derives (newRootKey, newChainKey) from (rootKey, dhOut)
 * - rootKey is used as HKDF salt (domain separation and binding)
 * - dhOut is the input key material
 */
export function kdfRootKey(params: {
  rootKey: Uint8Array; // 32 bytes
  dhOut: Uint8Array;   // 32 bytes
}): { newRootKey: Uint8Array; newChainKey: Uint8Array } {
  // 64 bytes output: 32 root + 32 chain
  const okm = hkdfSha256({
    ikm: params.dhOut,
    salt: params.rootKey,
    info: INFO_RK,
    length: 64,
  });

  return {
    newRootKey: okm.slice(0, 32),
    newChainKey: okm.slice(32, 64),
  };
}
