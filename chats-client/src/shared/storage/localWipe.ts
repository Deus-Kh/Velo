import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * Per-user local-state wipe (T1.14 / P0-12).
 *
 * Everything the app stores is namespaced by userId, so the wipe is scoped
 * and never touches another account on the same device.
 *
 * Scopes:
 *  - 'messages': sessions, archived message keys and the history master key,
 *    plus the plaintext outgoing queue. After this, nothing on disk can
 *    decrypt this account's messages. Identity, signed prekey, one-time prekey
 *    secrets and trust pins stay, so signing back in keeps the same identity
 *    (peers see no "safety number changed") — but existing conversations need
 *    a session reset until T2.11 handles re-bootstrap automatically.
 *  - 'all': 'messages' plus identity keys, signed prekey, one-time prekey
 *    secrets and trust pins. Signing back in generates a new identity.
 */
export type WipeScope = 'messages' | 'all';

const ASYNC_PREFIXES_MESSAGES = (userId: string) => [
  `session:v2:${userId}:`,
  `v2mk:${userId}:`,
  `pending_messages_v1:${userId}`,
];

const ASYNC_PREFIXES_ALL = (userId: string) => [
  ...ASYNC_PREFIXES_MESSAGES(userId),
  `otpk:${userId}:`,
  `trusted-identity:${userId}:`,
];

const KEYCHAIN_SERVICES_MESSAGES = (userId: string) => [`history-mk:${userId}`];

const KEYCHAIN_SERVICES_ALL = (userId: string) => [
  ...KEYCHAIN_SERVICES_MESSAGES(userId),
  `identity-sign:${userId}`,
  `identity-dh:${userId}`,
  `signed-prekey:${userId}`,
  `e2ee-keypair:${userId}`, // legacy v1 keypair, if present
];

export function asyncStoragePrefixesFor(userId: string, scope: WipeScope): string[] {
  return scope === 'all' ? ASYNC_PREFIXES_ALL(userId) : ASYNC_PREFIXES_MESSAGES(userId);
}

export function keychainServicesFor(userId: string, scope: WipeScope): string[] {
  return scope === 'all' ? KEYCHAIN_SERVICES_ALL(userId) : KEYCHAIN_SERVICES_MESSAGES(userId);
}

export interface WipeReport {
  removedKeys: number;
  resetServices: number;
  failures: string[];
}

export async function wipeLocalStateForUser(userId: string, scope: WipeScope): Promise<WipeReport> {
  const report: WipeReport = { removedKeys: 0, resetServices: 0, failures: [] };
  if (!userId) return report;

  const prefixes = asyncStoragePrefixesFor(userId, scope);
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove = allKeys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
    report.removedKeys = toRemove.length;
  } catch (e) {
    report.failures.push(`asyncStorage: ${(e as Error)?.message ?? String(e)}`);
  }

  for (const service of keychainServicesFor(userId, scope)) {
    try {
      await Keychain.resetGenericPassword({ service });
      report.resetServices += 1;
    } catch (e) {
      report.failures.push(`${service}: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  return report;
}
