/** Wire version the session speaks (spec §8.2). v1 was removed; v2 sessions are discarded on load. */
export type ProtoVersion = 3;

export type AnySession = RatchetSessionV2;

/**
 * Double Ratchet session state (spec §8.1).
 *
 * `v: 2` is the on-device format introduced by T2.0 (standard bootstrap).
 * A stored `v: 1` session (HKDF directional split, never ratcheted) is not
 * loadable and is discarded; the pair re-bootstraps on the next message.
 *
 * Chain keys are null until the corresponding chain exists: the responder
 * has no sending chain until it has received once, and neither side has a
 * receiving chain before the first inbound message.
 */
export interface RatchetSessionV2 {
  v: 2;
  protoVersion: 3;
  peerUserId: string;

  rootKey: string; // base64, 32 bytes
  chainKeySend: string | null; // CKs
  chainKeyRecv: string | null; // CKr

  Ns: number;
  Nr: number;
  PN: number;

  /** Skipped message keys keyed `${dhPubBase64}:${n}` (epoch-namespaced). Value: base64 message key. */
  skippedKeys?: Record<string, string>;
  /** Peer epochs (ratchet public keys) in the order they were entered, oldest first; eviction order for skipped keys (T2.6, never JS object order). */
  skippedEpochOrder?: string[];
  /** The last PEER_EPOCH_HISTORY peer ratchet keys seen, oldest first: tells an evicted epoch (UNKNOWN_OLD_MESSAGE) from an unknown one. */
  peerEpochHistory?: string[];

  DHsPublicKey: string; // our current ratchet key pair (base64 X25519)
  DHsPrivateKey: string;
  DHrPublicKey: string | null; // peer's current ratchet key; null until the first inbound message
}
