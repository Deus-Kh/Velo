/**
 * Prekey bundle as served by `GET /keys/bundle/:userId`. Mirrors the client's
 * API type so the protocol package has no dependency on the app layer.
 */
export interface PreKeyBundle {
  userId: string;
  identitySignPublicKey: string; // base64 (Ed25519 pub)
  identityDhPublicKey: string; // base64 (X25519 pub)
  identityBindingSignature: string; // base64 Ed25519 signature by IK_sign over IK_dh (T2.13)
  signedPreKey: {
    keyId: number;
    publicKey: string; // base64 (X25519 pub)
    signature: string; // base64 (Ed25519 detached signature)
  };
  oneTimePreKey: null | {
    keyId: number;
    publicKey: string; // base64 (X25519 pub)
  };
  remainingOneTimePreKeys?: number;
  /**
   * T3.5 PQ-readiness: a post-quantum (ML-KEM) last-resort or one-time prekey,
   * as PQXDH serves it. Ignored today: the client never encapsulates, the
   * server serves `null`. Present in the schema so adding PQXDH is a KEM
   * plus a wire bump, not a schema migration.
   */
  pqPreKey?: null | {
    keyId: number;
    kind: 'ml-kem-768' | 'ml-kem-1024';
    publicKey: string; // base64 KEM public key
    signature: string; // base64 Ed25519 signature by IK_sign over the key
  };
}
