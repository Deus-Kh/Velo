export type ProtoVersion = 1 | 2;

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

  // NEW: skipped message keys
  skippedKeys?: {
    [messageNumber: number]: string; // base64 messageKey
  };

  // DH ratchet placeholders
  DHsPublicKey: string | null;
  DHsPrivateKey: string | null;
  DHrPublicKey: string | null;
}
