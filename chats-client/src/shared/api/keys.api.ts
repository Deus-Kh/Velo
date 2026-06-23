import {http} from './http';

export interface IdentityKeyResponse{
    userId:string,
    identitySignPublicKey:string
}

export interface PreKeyBundleResponse {
  userId: string;
  identitySignPublicKey: string; // base64 (Ed25519 pub)
  identityDhPublicKey: string; // base64 X25519 pub

  signedPreKey: {
    keyId: number;
    publicKey: string;  // base64 (X25519 pub)
    signature: string;  // base64 (Ed25519 detached signature)
  };
  oneTimePreKey: null | {
    keyId: number;
    publicKey: string; // base64 (X25519 pub)
  };
}

export interface UnusedPreKeysCountResponse {
  unused: number;
}

export const keysApi={
    uploadIdentityKey:(identitySignPublicKey:string)=>
        http.post('/keys/identity',{identitySignPublicKey}),
        
    
    getIdentityKey:(userId:string)=>
        http.get<IdentityKeyResponse>(`/keys/identity/${userId}`),

    uploadSignedPreKey: (data: { keyId: number; publicKey: string; signature: string }) =>
    http.post('/keys/signed-prekey', data),

  uploadOneTimePreKeys: (items: Array<{ keyId: number; publicKey: string }>) =>
    http.post('/keys/prekeys', { items }),

  getPreKeyBundle: (userId: string) =>
    http.get<PreKeyBundleResponse>(`/keys/bundle/${userId}`),
  
  getUnusedOneTimePreKeysCount: () =>
    http.get<UnusedPreKeysCountResponse>('/keys/prekeys/unused-count'),

  uploadIdentityDhKey: (identityDhPublicKey: string) =>
  http.post('/keys/identity-dh', { identityDhPublicKey }),

}
