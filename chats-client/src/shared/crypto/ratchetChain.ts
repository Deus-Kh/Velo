import { hmacSha256 } from './kdf';

const LABEL_MESSAGE_KEY = new Uint8Array([1]);
const LABEL_CHAIN_KEY = new Uint8Array([2]);

export type ChainStep = {
  messageKey: Uint8Array;   // 32 bytes
  nextChainKey: Uint8Array; // 32 bytes
};

/**
 * One step of the symmetric (chain) ratchet:
 * MK = HMAC(CK, 0x01)
 * CK = HMAC(CK, 0x02)
 */
export function chainKdf(chainKey: Uint8Array): ChainStep {
  const messageKey = hmacSha256(chainKey, LABEL_MESSAGE_KEY);
  const nextChainKey = hmacSha256(chainKey, LABEL_CHAIN_KEY);
  return { messageKey, nextChainKey };
}
