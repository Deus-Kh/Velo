import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import { sessionMasterKeyService } from '../crypto/sessionMasterKey';
import { listVerifiedPeerUserIds } from '../storage/trustedIdentities';

export type SecurityDiagnostics = {
  identityKeyReady: boolean;
  identityDhReady: boolean;
  signedPreKeyReady: boolean;
  /** The per-user session master key that seals sessions, secrets and the local message store (T1.3, T2.14). */
  sessionMasterKeyReady: boolean;
  sessionCount: number;
  trustedContactsCount: number;
  storedMessagesCount: number;
  oneTimePreKeysCount: number;
};

/**
 * C1: what the Settings screen knows about the keys and sessions on this
 * phone, counted from the keychain and the local store. Loaded on mount;
 * the screen reloads it on focus and after a reset.
 */
export function useSecurityDiagnostics(userId: string | null) {
  const [diagnostics, setDiagnostics] = useState<SecurityDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  const loadDiagnostics = useCallback(async () => {
    if (!userId) {
      setDiagnostics(null);
      setDiagnosticsLoading(false);
      return;
    }

    setDiagnosticsLoading(true);

    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const [
        identityKeyCreds,
        identityDhCreds,
        signedPreKeyCreds,
        sessionMasterKeyCreds,
      ] = await Promise.all([
        Keychain.getGenericPassword({ service: `identity-sign:${userId}` }),
        Keychain.getGenericPassword({ service: `identity-dh:${userId}` }),
        Keychain.getGenericPassword({ service: `signed-prekey:${userId}` }),
        Keychain.getGenericPassword({ service: sessionMasterKeyService(userId) }),
      ]);

      setDiagnostics({
        identityKeyReady: Boolean(identityKeyCreds),
        identityDhReady: Boolean(identityDhCreds),
        signedPreKeyReady: Boolean(signedPreKeyCreds),
        sessionMasterKeyReady: Boolean(sessionMasterKeyCreds),
        sessionCount: allKeys.filter((key) => key.startsWith(`session:v2:${userId}:`)).length,
        // C2: contacts the user marked as verified, not every silent first-contact pin.
        trustedContactsCount: (await listVerifiedPeerUserIds(userId)).length,
        storedMessagesCount: allKeys.filter((key) => key.startsWith(`msg:v1:${userId}:`)).length,
        oneTimePreKeysCount: allKeys.filter((key) => key.startsWith(`otpk:${userId}:`)).length,
      });
    } catch (error) {
      console.warn('[Settings] Failed to load secure diagnostics:', error);
      setDiagnostics(null);
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  const keyStateValue = diagnosticsLoading
    ? 'Checking'
    : diagnostics?.identityKeyReady && diagnostics?.identityDhReady
      ? 'Ready'
      : 'Missing';

  const encryptionValue = diagnosticsLoading
    ? 'Checking'
    : diagnostics?.sessionMasterKeyReady
      ? 'Enabled'
      : 'Preparing';

  return { diagnostics, diagnosticsLoading, loadDiagnostics, keyStateValue, encryptionValue };
}
