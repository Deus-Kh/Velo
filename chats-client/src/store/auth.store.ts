

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import { decodeBase64 } from 'tweetnacl-util';

import { authApi } from '../shared/api/auth.api';
import type { LoginRequest, RegisterRequest } from '../shared/api/auth.types';
import { ensureIdentityDhKeyPairForUser } from '../shared/crypto/identityDhKeys';


import {
  initSocket,
  ensureSocketConnected,
  disconnectSocket,
} from '../shared/socket/socket';
import { drainPendingMessagesForUser } from '../shared/chat/drainPendingMessages';
import { wipeLocalStateForUser } from '../shared/storage/localWipe';

import { sharedSecretCache } from '../shared/crypto/sharedSecretCache';

import { keysApi } from '../shared/api/keys.api';
import { ensureIdentityKeyPairForUser } from '../shared/crypto/identityKeys';
import { ensurePreKeysForUser, topUpOneTimePreKeysIfNeeded } from '../shared/crypto/prekeys';
import { getOrCreateHistoryMasterKey } from '../shared/crypto/historyMasterKey';
import {
  getNotificationPreferencesForUser,
  useNotificationPreferencesStore,
} from './notification-preferences.store';
import {
  syncPushTokenWithServer,
  startPushTokenRefreshSync,
  unregisterPushTokenFromServer,
} from '../shared/notifications/sync';

interface AuthState {
  userId: string | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  /**
   * Signs out. By default protocol state stays on disk (encrypted at rest
   * after T1.3) so signing back in keeps sessions and identity. With
   * `eraseLocalData`, sessions, message keys, the history master key and the
   * plaintext outgoing queue are wiped first ('messages' scope).
   */
  logout: (opts?: { eraseLocalData?: boolean }) => Promise<void>;
  hydrate: () => Promise<void>;
}

let socketDrainCleanup: (() => void) | null = null;
let pushTokenRefreshCleanup: (() => void) | null = null;
let foregroundTopUpCleanup: (() => void) | null = null;

/**
 * Re-checks the one-time prekey pool whenever the app returns to the
 * foreground (throttled inside topUpOneTimePreKeysIfNeeded), so a user who
 * receives many new conversations between logins does not run dry.
 */
function startForegroundPreKeyTopUp(userId: string): () => void {
  const onChange = (state: AppStateStatus) => {
    if (state !== 'active') return;
    topUpOneTimePreKeysIfNeeded(userId).catch((e) =>
      console.warn('[prekeys] foreground top-up failed:', (e as Error)?.message ?? e),
    );
  };
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

async function persistCredentials(userId: string, accessToken: string): Promise<void> {
  await AsyncStorage.multiSet([
    ['accessToken', accessToken],
    ['userId', userId],
  ]);
}

/**
 * Ensure legacy E2EE device keypair exists (current chat crypto).
 * Stored per-userId → safe for multi-accounts.
 */
/**
 * Unified post-auth bootstrap.
 * Safe to call from login / register / hydrate.
 */
async function bootstrapAfterAuth(userId: string, token: string) {
  // Clear per-session crypto cache (important for multi-accounts)
  sharedSecretCache.clear();

  // 1) Identity signing key (Ed25519)
  try {
    const identityPub = await ensureIdentityKeyPairForUser(userId);
    await keysApi.uploadIdentityKey(identityPub);
  } catch (e) {
    console.warn('Identity key setup failed:', e);
  }

  try {
  const identityDhPub = await ensureIdentityDhKeyPairForUser(userId);
  await keysApi.uploadIdentityDhKey(identityDhPub);
} catch (e) {
  console.warn('Identity DH key setup failed:', e);
}

  // 1.5) History master key for at-rest protection
  try {
    await getOrCreateHistoryMasterKey(userId);
  } catch (e) {
    console.warn('History master key setup failed:', e);
  }

  // 2) PreKeys (SignedPreKey + One-time PreKeys)
  try {
    await ensurePreKeysForUser(userId);
  } catch (e) {
    console.warn('Prekeys setup failed:', e);
  }
  foregroundTopUpCleanup?.();
  foregroundTopUpCleanup = startForegroundPreKeyTopUp(userId);

  // 3) Socket
  const socket = initSocket(token);

  socketDrainCleanup?.();
  const handleSocketConnect = () => {
    drainPendingMessagesForUser(userId).catch((e) =>
      console.warn('Pending message drain failed after reconnect:', e),
    );
  };
  socket.on('connect', handleSocketConnect);
  socketDrainCleanup = () => socket.off('connect', handleSocketConnect);

  ensureSocketConnected()
    .then(() => drainPendingMessagesForUser(userId))
    .catch((e) => console.warn('Socket connect failed:', e));
  console.log('[auth] socket init for user', userId, 'token?', !!token);

  pushTokenRefreshCleanup?.();
  pushTokenRefreshCleanup = null;

  try {
    const preferences = getNotificationPreferencesForUser(
      useNotificationPreferencesStore.getState().preferencesByUserId,
      userId,
    );
    await syncPushTokenWithServer(preferences.pushEnabled);
    pushTokenRefreshCleanup = startPushTokenRefreshSync(userId);
  } catch (e) {
    console.warn('Push token sync failed:', e);
  }

}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (data) => {
    // The whole flow runs inside try/finally so that a failed request can never
    // leave `isLoading: true`, which would make Navigation render nothing (P0-11).
    // The caller (LoginScreen) catches the rethrown error and shows it.
    set({ isLoading: true });
    try {
      const res = await authApi.login(data);
      await persistCredentials(res.data.userId, res.data.accessToken);
      set({ token: res.data.accessToken, userId: res.data.userId, isAuthenticated: false });

      try {
        await bootstrapAfterAuth(res.data.userId, res.data.accessToken);
      } catch (e) {
        // Credentials are valid; a bootstrap hiccup (e.g. push registration)
        // must not block sign-in. Log and continue authenticated.
        console.warn('[auth] post-login bootstrap failed:', (e as Error)?.message);
      }

      set({ token: res.data.accessToken, userId: res.data.userId, isAuthenticated: true });
    } catch (e) {
      set({ token: null, userId: null, isAuthenticated: false });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (data) => {
    set({ isLoading: true });
    try {
      const res = await authApi.register(data);
      await persistCredentials(res.data.userId, res.data.accessToken);
      set({ token: res.data.accessToken, userId: res.data.userId, isAuthenticated: false });

      try {
        await bootstrapAfterAuth(res.data.userId, res.data.accessToken);
      } catch (e) {
        console.warn('[auth] post-register bootstrap failed:', (e as Error)?.message);
      }

      set({ token: res.data.accessToken, userId: res.data.userId, isAuthenticated: true });
    } catch (e) {
      set({ token: null, userId: null, isAuthenticated: false });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async (opts) => {
    const currentUserId = useAuthStore.getState().userId;

    try {
      // Regardless of the push preference: a device that is no longer signed
      // in must not keep a live token on the server (T1.14).
      await unregisterPushTokenFromServer();
    } catch (e) {
      console.warn('Push token unregister failed:', (e as Error)?.message ?? e);
    }

    sharedSecretCache.clear();
    socketDrainCleanup?.();
    socketDrainCleanup = null;
    pushTokenRefreshCleanup?.();
    pushTokenRefreshCleanup = null;
    foregroundTopUpCleanup?.();
    foregroundTopUpCleanup = null;
    disconnectSocket();

    if (opts?.eraseLocalData && currentUserId) {
      const report = await wipeLocalStateForUser(currentUserId, 'messages');
      if (report.failures.length) {
        console.warn('[auth] local wipe incomplete:', report.failures.join('; '));
      }
    }

    await AsyncStorage.multiRemove(['accessToken', 'userId']);

    set({
      token: null,
      userId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  hydrate: async () => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      const userId = await AsyncStorage.getItem('userId');

      if (!token || !userId) {
        set({ isLoading: false });
        return;
      }




      
      // Check if token is expired
      // try {
      //   const payload = token.split('.')[1];
      //   const decoded_bytes = decodeBase64(payload);
      //   const payloadString = String.fromCharCode.apply(null, Array.from(decoded_bytes));
      //   const decoded: any = JSON.parse(payloadString);
      //   const now = Math.floor(Date.now() / 1000);
        
      //   if (decoded.exp && decoded.exp < now) {
      //     console.warn('[auth] token expired during hydrate, clearing');
      //     await AsyncStorage.multiRemove(['accessToken', 'userId']);
      //     set({ isLoading: false });
      //     return;
      //   }
      // } catch (decodeErr) {
      //   console.warn('[auth] Failed to decode token:', (decodeErr as any)?.message);
      //   // If we can't decode, try using it anyway
      // }

      set({
        token,
        userId,
        isAuthenticated: false,
        isLoading: true,
      });

      try {
        await bootstrapAfterAuth(userId, token);
      } finally {
        set({
          token,
          userId,
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch (e) {
      console.warn('Hydrate failed:', e);
      set({ isLoading: false });
    }
  },
}));
