/**
 * @velo/protocol — the pure cryptographic core.
 *
 * Nothing in this package may import the platform, storage, keychain or
 * network layers (enforced by .eslintrc.js and test/noPlatformImports.test.ts). Storage and
 * transport live in the client; this package only computes.
 *
 * T2.1 moved the pure modules here unchanged (session creation split into a
 * pure builder). T2.2 made the ratchet steps pure: they return the next
 * session, and the client adapter persists it (T3.4: no key material leaves
 * a step; every intermediate key is wiped). T2.4
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
export { wipe } from './primitives/zeroize';

export { chainKdf, type ChainStep } from './ratchet/chain';
export { kdfRootKey } from './ratchet/root';
export { dhRatchet } from './ratchet/dh';
export { initInitiatorSession, initResponderSession, sessionHasReceived, glareWinner, type DhKeyPairB64 } from './ratchet/session';
export {
  ratchetEncrypt,
  ratchetDecrypt,
  decryptHeader,
  skippedKeyId,
  pruneSkippedKeys,
  type HeaderEpoch,
  type EncryptOptions,
  type MessageHeader,
  type MessageEnvelope,
  type AssociatedData,
  type RatchetEncryptResult,
  type RatchetDecryptResult,
} from './ratchet/message';
export {
  canonicalHeaderBytes,
  decodeCanonicalHeader,
  sealHeader,
  openHeader,
  encryptedHeaderBytes,
  WIRE_VERSION,
  ENCRYPTED_HEADER_LENGTH,
  HEADER_NONCE_LENGTH,
} from './ratchet/header';
export { MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, MAX_SKIP_EPOCHS, MAX_MESSAGE_NUMBER, PEER_EPOCH_HISTORY, REPLAY_WINDOW } from './ratchet/limits';
export { expandMessageKey, type ExpandedMessageKeys } from './ratchet/messageKeys';
export { sealMessage, openMessage, associatedDataBytes, MAC_LENGTH } from './ratchet/envelope';

export type { ProtoVersion, AnySession, RatchetSessionV2 } from './types/session';

export { verifySignedPreKeyBundle } from './handshake/bundle';
export type { PreKeyBundle } from './handshake/types';
export { x3dhInitiate, x3dhRespond, INFO_X3DH, KEM_SHARED_SECRET_LENGTH, type X3DHInitPacket, type X3DHSessionKeys } from './handshake/x3dh';
export {
  signSignedPreKey,
  verifySignedPreKey,
  signedPreKeyMessage,
  rotateSignedPreKeySet,
  selectSignedPreKey,
  shouldRotateSignedPreKey,
  isSignedPreKeyExpired,
  SIGNED_PREKEY_DOMAIN,
  SIGNED_PREKEY_ROTATE_AFTER_MS,
  SIGNED_PREKEY_RETAIN_MS,
  type SignedPreKeyRecord,
  type SignedPreKeySet,
} from './handshake/signedPrekey';

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

// Phase 6' groups (T6.1): Sender Keys
export {
  createSenderKeyState,
  senderKeyDistributionMessage,
  senderKeyStateFromDistribution,
  SENDER_KEY_VERSION,
  SENDER_KEY_DEVICE_ID,
  type SenderKeyState,
  type SenderKeyDistributionMessage,
} from './senderkey/state';
export {
  groupEncrypt,
  groupDecrypt,
  groupMessageSignedBytes,
  type GroupMessage,
  type GroupAssociatedData,
  type GroupEncryptResult,
  type GroupDecryptResult,
} from './senderkey/message';
