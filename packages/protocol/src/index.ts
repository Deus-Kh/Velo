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
 * moved the X3DH math here; the client keeps only the I/O wrappers. T2.0
 * replaced the HKDF directional split with the standard Double Ratchet
 * initialisation (initInitiatorSession / initResponderSession).
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
export { dhRatchet } from './ratchet/dh';
export { initInitiatorSession, initResponderSession, type DhKeyPairB64 } from './ratchet/session';
export {
  ratchetEncrypt,
  ratchetDecrypt,
  skippedKeyId,
  pruneSkippedKeys,
  type MessageHeader,
  type MessageEnvelope,
  type AssociatedData,
  type V2Header,
  type V2Encrypted,
  type DerivedMessageKey,
  type RatchetEncryptResult,
  type RatchetDecryptResult,
} from './ratchet/message';
export { canonicalHeaderBytes, decodeCanonicalHeader, WIRE_VERSION } from './ratchet/header';
export { MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, MAX_SKIP_EPOCHS, MAX_MESSAGE_NUMBER, PEER_EPOCH_HISTORY } from './ratchet/limits';
export { expandMessageKey, type ExpandedMessageKeys } from './ratchet/messageKeys';
export { sealMessage, openMessage, decryptWithMessageKey, associatedDataBytes, MAC_LENGTH } from './ratchet/envelope';

export type { ProtoVersion, AnySession, RatchetSessionV2 } from './types/session';

export { verifySignedPreKeyBundle } from './handshake/bundle';
export type { PreKeyBundle } from './handshake/types';
export { x3dhInitiate, x3dhRespond, INFO_X3DH_V1, type X3DHInitPacket, type X3DHSessionKeys } from './handshake/x3dh';

export {
  computeSafetyNumber,
  fingerprintHalf,
  displayableFingerprint,
  groupDigits,
  FINGERPRINT_ITERATIONS,
  FINGERPRINT_VERSION,
} from './identity/fingerprint';
export {
  signIdentityBinding,
  verifyIdentityBinding,
  IDENTITY_BINDING_DOMAIN,
  type Identity,
  type BoundIdentity,
} from './identity/binding';
export { checkIdentity, requireIdentityMatch, type IdentityCheck } from './identity/trust';
