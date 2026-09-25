import axios from 'axios';
import { env } from '../config/env';
import { API_ENDPOINTS } from '../api/endpoints';
import { updateSocketAuthToken } from '../socket/socket';
import { isJwtExpiring } from './jwt';
import { singleFlight } from './singleFlight';
import { clearStoredSession, loadStoredSession, saveStoredSession } from './tokenStore';

/**
 * Access-token lifecycle (T1.10). Owns the in-memory access token, refreshes
 * it through `/auth/refresh` with a single in-flight request, and tells the
 * socket layer about new tokens. The auth store subscribes to `onSessionLost`
 * to route the user to the login screen when a refresh finally fails.
 */

let accessToken: string | null = null;
let sessionLostListener: (() => void) | null = null;

// A bare client: the interceptors on `http` would recurse into refresh.
const refreshClient = axios.create({
  baseURL: env.API_URL,
  timeout: 10000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  updateSocketAuthToken(token);
}

export function onSessionLost(listener: (() => void) | null): void {
  sessionLostListener = listener;
}

export class SessionLostError extends Error {
  constructor(readonly code: string) {
    super(`Session lost: ${code}`);
    this.name = 'SessionLostError';
  }
}

/**
 * Exchanges the stored refresh token for a new pair. Concurrent callers
 * share one request. On a terminal failure (401 from the server) the stored
 * session is cleared and the listener is notified; network errors are
 * rethrown as-is so the caller can retry later without logging out.
 */
export const refreshSession = singleFlight(async (): Promise<string> => {
  const stored = await loadStoredSession();
  if (!stored) throw new SessionLostError('NO_REFRESH_TOKEN');

  try {
    const res = await refreshClient.post<{ accessToken: string; refreshToken: string; userId: string }>(
      API_ENDPOINTS.AUTH.REFRESH,
      { refreshToken: stored.refreshToken },
    );
    await saveStoredSession({ userId: res.data.userId, refreshToken: res.data.refreshToken });
    setAccessToken(res.data.accessToken);
    return res.data.accessToken;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response && (e.response.status === 401 || e.response.status === 400)) {
      const code = (e.response.data as { code?: string } | undefined)?.code ?? 'REFRESH_REJECTED';
      await clearStoredSession();
      setAccessToken(null);
      sessionLostListener?.();
      throw new SessionLostError(code);
    }
    throw e;
  }
});

/** Returns a usable access token, refreshing first if the current one is about to expire. */
export async function ensureFreshAccessToken(now = Date.now()): Promise<string | null> {
  if (accessToken && !isJwtExpiring(accessToken, now)) return accessToken;
  const stored = await loadStoredSession();
  if (!stored) return accessToken;
  try {
    return await refreshSession();
  } catch (e) {
    if (e instanceof SessionLostError) return null;
    // Network trouble: fall back to whatever we have; the 401 path retries.
    return accessToken;
  }
}
