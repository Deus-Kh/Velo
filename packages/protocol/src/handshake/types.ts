/**
 * Prekey bundle as served by `GET /keys/bundle/:userId`. Mirrors the client's
 * API type so the protocol package has no dependency on the app layer.
 */
export interface PreKeyBundle {
  userId: string;
  identitySignPublicKey: string; // base64 (Ed25519 pub)
  identityDhPublicKey: string; // base64 (X25519 pub)
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
}
