import { keysApi, type PreKeyBundleResponse } from '../api/keys.api';
import { verifySignedPreKeyBundle } from '@velo/protocol';
import { enforcePinnedIdentity } from './identityTrust';

/**
 * Fetch the peer's prekey bundle and refuse it unless (a) its signed prekey
 * is signed by its identity key, (b) its identity binding verifies, and
 * (c) its identity matches the pin (first contact pins it). (b) and (c) are
 * T2.13; the pure handshake re-checks (a) and (b) itself.
 */
export async function fetchAndVerifyPreKeyBundle(myUserId: string, peerUserId: string): Promise<PreKeyBundleResponse> {
  const res = await keysApi.getPreKeyBundle(peerUserId);
  const bundle = res.data;

  verifySignedPreKeyBundle(bundle);
  await enforcePinnedIdentity({
    myUserId,
    peerUserId,
    presented: {
      identitySignPublicKey: bundle.identitySignPublicKey,
      identityDhPublicKey: bundle.identityDhPublicKey,
      identityBindingSignature: bundle.identityBindingSignature,
    },
  });

  return bundle;
}
