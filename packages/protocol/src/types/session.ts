/** v1 (static shared-secret) was removed; only the ratchet wire format remains. */
export type ProtoVersion = 2;

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
  protoVersion: 2;
  peerUserId: string;

  rootKey: string; // base64, 32 bytes
  chainKeySend: string | null; // CKs
  chainKeyRecv: string | null; // CKr

  Ns: number;
  Nr: number;
  PN: number;

  /** Skipped message keys keyed `${dhPubBase64}:${n}` (epoch-namespaced). Value: base64 message key. */
  skippedKeys?: Record<string, string>;

  DHsPublicKey: string; // our current ratchet key pair (base64 X25519)
  DHsPrivateKey: string;
  DHrPublicKey: string | null; // peer's current ratchet key; null until the first inbound message
}
