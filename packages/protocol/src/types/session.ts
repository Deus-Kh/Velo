/** v1 (static shared-secret) was removed; only the ratchet wire format remains. */
export type ProtoVersion = 2;

export type AnySession = RatchetSessionV2;

export interface RatchetSessionV2 {
  v: 1;
  protoVersion: 2;
  peerUserId: string;

  rootKey: string;
  chainKeySend: string;
  chainKeyRecv: string;

  Ns: number;
  Nr: number;
  PN: number;

  /**
   * Skipped message keys, keyed `${dhPubBase64}:${messageNumber}` (epoch-
   * namespaced — see the client's messageV2.ts skippedKeyId (moves here in T2.2)). Value: base64 message key.
   */
  skippedKeys?: Record<string, string>;

  // DH ratchet placeholders
  DHsPublicKey: string | null;
  DHsPrivateKey: string | null;
  DHrPublicKey: string | null;
}
