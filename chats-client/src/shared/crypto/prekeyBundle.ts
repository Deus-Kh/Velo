import { keysApi, type PreKeyBundleResponse } from '../api/keys.api';
import { verifySignedPreKeyBundle } from './prekeyBundleVerify';

export async function fetchAndVerifyPreKeyBundle(peerUserId: string): Promise<PreKeyBundleResponse> {
  const res = await keysApi.getPreKeyBundle(peerUserId);

  // throws if tampered
  verifySignedPreKeyBundle(res.data);

  return res.data;
}
