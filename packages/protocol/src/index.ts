/**
 * @velo/protocol — the pure cryptographic core.
 *
 * Nothing in this package may import the platform, storage, keychain or
 * network layers (enforced by .eslintrc.js and test/noPlatformImports.test.ts). Storage and
 * transport live in the client; this package only computes.
 *
 * T2.1 moved the pure modules here unchanged (session creation split into a
 * pure builder). The ratchet encrypt/decrypt and the X3DH handshake still
 * live in the client until T2.2 strips their I/O.
 */

export { normalizeB64 } from './primitives/base64';
export { encodeKey, decodeKey } from './primitives/encoding';
export { utf8Encode, utf8Decode } from './primitives/utf8';
export { sha256Bytes, hmacSha256, hkdfSha256 } from './primitives/kdf';

export { chainKdf, type ChainStep } from './ratchet/chain';
export { kdfRootKey } from './ratchet/root';
export { applyDhRatchet } from './ratchet/dh';
export { createSessionFromX3DH, type DhKeyPairB64 } from './ratchet/session';

export type { ProtoVersion, AnySession, RatchetSessionV2 } from './types/session';

export { verifySignedPreKeyBundle } from './handshake/bundle';
export type { PreKeyBundle } from './handshake/types';

export { computeSafetyNumber } from './identity/fingerprint';
