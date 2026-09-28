import { http } from './http';

/** GET /keys/identity/:userId (T2.13: both keys and the binding). */
export interface IdentityKeyResponse {
  userId: string;
  identitySignPublicKey: string; // base64 Ed25519 pub
  identityDhPublicKey: string | null; // base64 X25519 pub; null until the peer runs a T2.13 client
  identityBindingSignature: string | null; // base64 Ed25519 signature by IK_sign over IK_dh
  identityChangedAt: string | null;
}

export interface PreKeyBundleResponse {
  userId: string;
  identitySignPublicKey: string; // base64 (Ed25519 pub)
  identityDhPublicKey: string; // base64 X25519 pub
  identityBindingSignature: string; // base64 (T2.13); rejected by the client when missing

  signedPreKey: {
    keyId: number;
    publicKey: string; // base64 (X25519 pub)
    signature: string; // base64 (Ed25519 detached signature)
  };
  oneTimePreKey: null | {
    keyId: number;
    publicKey: string; // base64 (X25519 pub)
  };
  /**
   * How many unused one-time prekeys the peer still has AFTER this issue.
   * Informational: 0 means this bundle was issued without a one-time key
   * (weaker forward secrecy for this handshake).
   */
  remainingOneTimePreKeys?: number;
}

export interface UnusedPreKeysCountResponse {
  unused: number;
}

export const keysApi = {
  /** Legacy single-key uploads (pre-T2.13 server routes; kept for rollout). */
  uploadIdentityKey: (identitySignPublicKey: string) => http.post('/keys/identity', { identitySignPublicKey }),
  uploadIdentityDhKey: (identityDhPublicKey: string) => http.post('/keys/identity-dh', { identityDhPublicKey }),

  /** T2.13: both identity keys and the binding in one call. */
  uploadIdentity: (identity: { identitySignPublicKey: string; identityDhPublicKey: string; identityBindingSignature: string }) =>
    http.post('/keys/identity', identity),

  getIdentityKey: (userId: string) => http.get<IdentityKeyResponse>(`/keys/identity/${userId}`),

  uploadSignedPreKey: (data: { keyId: number; publicKey: string; signature: string }) => http.post('/keys/signed-prekey', data),

  uploadOneTimePreKeys: (items: Array<{ keyId: number; publicKey: string }>) => http.post('/keys/prekeys', { items }),

  getPreKeyBundle: (userId: string) => http.get<PreKeyBundleResponse>(`/keys/bundle/${userId}`),

  getUnusedOneTimePreKeysCount: () => http.get<UnusedPreKeysCountResponse>('/keys/prekeys/unused-count'),
};
