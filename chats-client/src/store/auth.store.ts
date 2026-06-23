

import { create } from 'zustand';
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

import { sharedSecretCache } from '../shared/crypto/sharedSecretCache';

import { keysApi } from '../shared/api/keys.api';
import { ensureIdentityKeyPairForUser } from '../shared/crypto/identityKeys';
import { ensurePreKeysForUser } from '../shared/crypto/prekeys';
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
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

let socketDrainCleanup: (() => void) | null = null;
let pushTokenRefreshCleanup: (() => void) | null = null;

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
    set({ isLoading: true });
    const res = await authApi.login(data);

    await AsyncStorage.setItem('accessToken', res.data.accessToken);
    await AsyncStorage.setItem('userId', res.data.userId);

    set({
      token: res.data.accessToken,
      userId: res.data.userId,
      isAuthenticated: false,
    });

    try {
      await bootstrapAfterAuth(res.data.userId, res.data.accessToken);
    } finally {
      set({
        token: res.data.accessToken,
        userId: res.data.userId,
        isAuthenticated: true,
        isLoading: false,
      });
    }
  },

  register: async (data) => {
    set({ isLoading: true });
    const res = await authApi.register(data);

    await AsyncStorage.setItem('accessToken', res.data.accessToken);
    await AsyncStorage.setItem('userId', res.data.userId);

    set({
      token: res.data.accessToken,
      userId: res.data.userId,
      isAuthenticated: false,
    });

    try {
      await bootstrapAfterAuth(res.data.userId, res.data.accessToken);
    } finally {
      set({
        token: res.data.accessToken,
        userId: res.data.userId,
        isAuthenticated: true,
        isLoading: false,
      });
    }
  },

  logout: async () => {
    try {
      const currentUserId = useAuthStore.getState().userId;
      const preferences = getNotificationPreferencesForUser(
        useNotificationPreferencesStore.getState().preferencesByUserId,
        currentUserId,
      );
      await unregisterPushTokenFromServer(preferences.pushEnabled);
    } catch (e) {
      console.warn('Push token unregister failed:', e);
    }

    sharedSecretCache.clear();
    socketDrainCleanup?.();
    socketDrainCleanup = null;
    pushTokenRefreshCleanup?.();
    pushTokenRefreshCleanup = null;
    disconnectSocket();

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
