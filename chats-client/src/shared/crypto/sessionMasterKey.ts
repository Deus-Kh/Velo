import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

/** Keychain service of the per-user session master key (exported for the settings diagnostics). */
export function sessionMasterKeyService(userId: string) {
  return `session-mk:${userId}`;
}

/**
 * Master key that encrypts ratchet session state, one-time prekey secrets and
 * the outgoing queue at rest, and authenticates trust pins (T1.3 / P0-3).
 *
 * Deliberately a separate Keychain entry from the history master key: history
 * keys are lower-value than live session state, and separating them limits
 * the blast radius if one entry is exposed.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (iOS): never migrates to another device via
 * backup or transfer, and is unavailable while the device is locked — which
 * means background processing on a locked iPhone fails closed. Android
 * ignores the option; Keystore-backed storage applies there.
 */
export async function getOrCreateSessionMasterKey(userId: string): Promise<Uint8Array> {
  const creds = await Keychain.getGenericPassword({ service: sessionMasterKeyService(userId) });
  if (creds !== false && creds?.password) {
    const mk = decodeBase64(creds.password);
    if (mk.length === 32) return mk;
  }

  const mk = nacl.randomBytes(32);
  await Keychain.setGenericPassword('session-mk', encodeBase64(mk), {
    service: sessionMasterKeyService(userId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return mk;
}
