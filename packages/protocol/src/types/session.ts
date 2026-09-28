/** Wire version the session speaks (spec §8.2). v1 was removed; v2 sessions are discarded on load. */
export type ProtoVersion = 3;

export type AnySession = RatchetSessionV2;

/**
 * Double Ratchet session state (spec §8.1), header-encryption variant.
 *
 * `v: 3` is the on-device format introduced by T3.6 (header keys). `v: 2`
 * (T2.0, standard bootstrap, plaintext headers) and `v: 1` (HKDF
 * directional split) are not loadable and are discarded; the pair
 * re-bootstraps on the next message.
 *
 * Chain keys are null until the corresponding chain exists: the responder
 * has no sending chain until it has received once, and neither side has a
 * receiving chain before the first inbound message.
 */
export interface RatchetSessionV2 {
  v: 3;
  protoVersion: 3;
  peerUserId: string;

  rootKey: string; // base64, 32 bytes
  chainKeySend: string | null; // CKs
  chainKeyRecv: string | null; // CKr

  /** T3.6 header keys (Double Ratchet §4): HKs / HKr are null until the chain exists; NHKs / NHKr always exist. */
  headerKeySend: string | null; // HKs
  headerKeyRecv: string | null; // HKr
  nextHeaderKeySend: string; // NHKs
  nextHeaderKeyRecv: string; // NHKr
  /** Header keys of previous peer epochs (`dhPub` → HKr), kept with their skipped keys so a late message can still be recognised; pruned with skippedEpochOrder. */
  epochHeaderKeys?: Record<string, string>;

  Ns: number;
  Nr: number;
  PN: number;

  /** Skipped message keys keyed `${dhPubBase64}:${n}` (epoch-namespaced). Value: base64 message key. */
  skippedKeys?: Record<string, string>;
  /** Peer epochs (ratchet public keys) in the order they were entered, oldest first; eviction order for skipped keys (T2.6, never JS object order). */
  skippedEpochOrder?: string[];
  /** The last PEER_EPOCH_HISTORY peer ratchet keys seen, oldest first: tells an evicted epoch (UNKNOWN_OLD_MESSAGE) from an unknown one. */
  peerEpochHistory?: string[];
  /** T3.4: the last REPLAY_WINDOW consumed message ids (`dhPub:n`), oldest first. A second copy is REPLAY_DETECTED. */
  recentlyReceived?: string[];

  DHsPublicKey: string; // our current ratchet key pair (base64 X25519)
  DHsPrivateKey: string;
  DHrPublicKey: string | null; // peer's current ratchet key; null until the first inbound message
}
