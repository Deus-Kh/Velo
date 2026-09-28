/**
 * @velo/protocol — the pure cryptographic core.
 *
 * Nothing in this package may import the platform, storage, keychain or
 * network layers (enforced by .eslintrc.js and test/noPlatformImports.test.ts). Storage and
 * transport live in the client; this package only computes.
 *
 * T2.1 moved the pure modules here unchanged (session creation split into a
 * pure builder). T2.2 made the ratchet steps pure: they return the next
 * session and the derived keys, and the client adapter persists them. T2.4
 * moved the X3DH math here; the client keeps only the I/O wrappers.
 */

export {
  ProtocolError,
  isProtocolError,
  protocolErrorCode,
  PROTOCOL_ERROR_CODES,
  type ProtocolErrorCode,
  type ProtocolErrorContext,
} from './errors';

export { normalizeB64 } from './primitives/base64';
export { encodeKey, decodeKey } from './primitives/encoding';
export { utf8Encode, utf8Decode } from './primitives/utf8';
export { sha256Bytes, hmacSha256, hkdfSha256 } from './primitives/kdf';

export { chainKdf, type ChainStep } from './ratchet/chain';
export { kdfRootKey } from './ratchet/root';
export { applyDhRatchet } from './ratchet/dh';
export { createSessionFromX3DH, type DhKeyPairB64 } from './ratchet/session';
export {
  ratchetEncrypt,
  ratchetDecrypt,
  skippedKeyId,
  MAX_SKIP,
  type V2Header,
  type V2Encrypted,
  type DerivedMessageKey,
  type RatchetEncryptResult,
  type RatchetDecryptResult,
} from './ratchet/message';

export type { ProtoVersion, AnySession, RatchetSessionV2 } from './types/session';

export { verifySignedPreKeyBundle } from './handshake/bundle';
export type { PreKeyBundle } from './handshake/types';
export { x3dhInitiate, x3dhRespond, INFO_X3DH_V1, type X3DHInitPacket, type X3DHSessionKeys } from './handshake/x3dh';

export { computeSafetyNumber } from './identity/fingerprint';
