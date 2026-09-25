import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * Persistent session credentials (T1.10).
 *
 * The refresh token is a 30-day bearer credential, so it lives in the
 * Keychain (device-only accessibility). The access token is 15-minute
 * material and is kept only in memory; a cold start refreshes it. The
 * pre-T1.10 `accessToken`/`userId` AsyncStorage keys are read once for
 * migration and then removed.
 */

const SERVICE = 'auth-session';

export interface StoredSession {
  userId: string;
  refreshToken: string;
}

let cached: StoredSession | null | undefined; // undefined = not loaded yet

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (cached !== undefined) return cached;
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (creds !== false && creds?.password) {
      const parsed = JSON.parse(creds.password) as Partial<StoredSession>;
      if (typeof parsed.userId === 'string' && typeof parsed.refreshToken === 'string') {
        cached = { userId: parsed.userId, refreshToken: parsed.refreshToken };
        return cached;
      }
    }
  } catch (e) {
    console.warn('[auth] failed to read stored session:', (e as Error)?.message ?? e);
  }
  cached = null;
  return cached;
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  cached = session;
  await Keychain.setGenericPassword('auth-session', JSON.stringify(session), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearStoredSession(): Promise<void> {
  cached = null;
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (e) {
    console.warn('[auth] failed to clear stored session:', (e as Error)?.message ?? e);
  }
  await AsyncStorage.multiRemove(['accessToken', 'userId']);
}

/**
 * One-time migration from the pre-T1.10 layout. Returns the legacy access
 * token + userId if present (there is no refresh token to migrate: the user
 * keeps working until that access token expires, then signs in again).
 */
export async function readLegacyAccessSession(): Promise<{ userId: string; accessToken: string } | null> {
  const [accessToken, userId] = await Promise.all([
    AsyncStorage.getItem('accessToken'),
    AsyncStorage.getItem('userId'),
  ]);
  if (!accessToken || !userId) return null;
  return { userId, accessToken };
}

/** Test helper. */
export function __resetTokenStoreCache(): void {
  cached = undefined;
}
