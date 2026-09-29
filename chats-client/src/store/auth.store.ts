

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
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
import { deleteAllMediaForUser } from '../shared/media/mediaStore';
import {
  clearStoredSession,
  loadStoredSession,
  readLegacyAccessSession,
  saveStoredSession,
} from '../shared/auth/tokenStore';
import { getAccessToken, onSessionLost, refreshSession, SessionLostError, setAccessToken } from '../shared/auth/session';
import { isJwtExpiring } from '../shared/auth/jwt';


import { keysApi } from '../shared/api/keys.api';
import { ensureIdentityKeyPairForUser, getIdentitySecretKeyBytesForUser } from '../shared/crypto/identityKeys';
import { signIdentityBinding } from '@velo/protocol';
import { ensurePreKeysForUser, topUpOneTimePreKeysIfNeeded } from '../shared/crypto/prekeys';
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
  logout: (opts?: { eraseLocalData?: boolean; scope?: 'messages' | 'all' }) => Promise<void>;
  /** T7.6: delete the account on the server, then erase everything local and sign out. */
  deleteAccount: (password: string) => Promise<void>;
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

/**
 * Persists a fresh token pair (T1.10): the refresh token goes to the Keychain,
 * the access token stays in memory (and is handed to the socket layer).
 */
async function persistCredentials(userId: string, accessToken: string, refreshToken: string): Promise<void> {
  await saveStoredSession({ userId, refreshToken });
  setAccessToken(accessToken);
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

  // 1) Bound identity (T2.13): Ed25519 signing key, X25519 DH key and the
  //    binding signature that ties them, uploaded together.
  try {
    const identitySignPublicKey = await ensureIdentityKeyPairForUser(userId);
    const identityDhPublicKey = await ensureIdentityDhKeyPairForUser(userId);
    const identityBindingSignature = signIdentityBinding(await getIdentitySecretKeyBytesForUser(userId), identityDhPublicKey);
    await keysApi.uploadIdentity({ identitySignPublicKey, identityDhPublicKey, identityBindingSignature });
  } catch (e) {
    console.warn('Identity setup failed:', e);
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
      await persistCredentials(res.data.userId, res.data.accessToken, res.data.refreshToken);
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
      await persistCredentials(res.data.userId, res.data.accessToken, res.data.refreshToken);
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

  deleteAccount: async (password) => {
    await authApi.deleteAccount(password); // throws on a wrong password: nothing local changes
    await useAuthStore.getState().logout({ eraseLocalData: true, scope: 'all' });
  },

  logout: async (opts) => {
    const currentUserId = useAuthStore.getState().userId;

    try {
      // Revoke the refresh family server-side first, while the access token is still valid.
      const stored = await loadStoredSession();
      await authApi.logout(stored?.refreshToken ?? null);
    } catch (e) {
      console.warn('[auth] server-side logout failed (continuing locally):', (e as Error)?.message ?? e);
    }

    try {
      // Regardless of the push preference: a device that is no longer signed
      // in must not keep a live token on the server (T1.14).
      await unregisterPushTokenFromServer();
    } catch (e) {
      console.warn('Push token unregister failed:', (e as Error)?.message ?? e);
    }

    socketDrainCleanup?.();
    socketDrainCleanup = null;
    pushTokenRefreshCleanup?.();
    pushTokenRefreshCleanup = null;
    foregroundTopUpCleanup?.();
    foregroundTopUpCleanup = null;
    disconnectSocket();

    if (opts?.eraseLocalData && currentUserId) {
      const report = await wipeLocalStateForUser(currentUserId, opts.scope ?? 'messages');
      await deleteAllMediaForUser(currentUserId).catch((e) => console.warn('[auth] media wipe failed:', e)); // T8.3
      if (report.failures.length) {
        console.warn('[auth] local wipe incomplete:', report.failures.join('; '));
      }
    }

    await clearStoredSession();
    setAccessToken(null);

    set({
      token: null,
      userId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  /**
   * Cold start. Order of preference:
   *  1. a stored refresh token (T1.10) → refresh to obtain a fresh access token;
   *  2. a legacy pre-T1.10 access token in AsyncStorage → use it until it
   *     expires (there is no refresh token to migrate), then the 401 path
   *     forces a sign-in.
   * A refresh rejected by the server means the session is gone: land on Login.
   */
  hydrate: async () => {
    try {
      const stored = await loadStoredSession();
      let token: string | null = null;
      let userId: string | null = null;

      if (stored) {
        try {
          token = await refreshSession();
          userId = stored.userId;
        } catch (e) {
          if (e instanceof SessionLostError) {
            set({ token: null, userId: null, isAuthenticated: false, isLoading: false });
            return;
          }
          // Offline at launch: keep the session, we'll refresh on the first 401.
          console.warn('[auth] refresh at launch failed, continuing offline:', (e as Error)?.message ?? e);
          userId = stored.userId;
          token = getAccessToken();
        }
      } else {
        const legacy = await readLegacyAccessSession();
        if (!legacy || isJwtExpiring(legacy.accessToken, Date.now(), 0)) {
          if (legacy) await clearStoredSession(); // expired leftover
          set({ isLoading: false });
          return;
        }
        token = legacy.accessToken;
        userId = legacy.userId;
        setAccessToken(token);
      }

      set({ token, userId, isAuthenticated: false, isLoading: true });

      try {
        if (userId) await bootstrapAfterAuth(userId, token ?? '');
      } finally {
        set({ token, userId, isAuthenticated: true, isLoading: false });
      }
    } catch (e) {
      console.warn('Hydrate failed:', e);
      set({ isLoading: false });
    }
  },
}));

// When a refresh is finally rejected (revoked family, expired), drop to Login.
onSessionLost(() => {
  const state = useAuthStore.getState();
  if (!state.isAuthenticated) return;
  socketDrainCleanup?.();
  socketDrainCleanup = null;
  pushTokenRefreshCleanup?.();
  pushTokenRefreshCleanup = null;
  foregroundTopUpCleanup?.();
  foregroundTopUpCleanup = null;
  disconnectSocket();
  useAuthStore.setState({ token: null, userId: null, isAuthenticated: false, isLoading: false });
});
