import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { API_ENDPOINTS } from './endpoints';
import { ensureFreshAccessToken, getAccessToken, refreshSession, SessionLostError } from '../auth/session';

export const http = axios.create({
  baseURL: env.API_URL,
  timeout: 10000,
  headers: {
    'Accept':'application/json',
    'Content-Type':'application/json'
  },
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

const AUTH_FREE_PATHS = new Set<string>([
  API_ENDPOINTS.AUTH.LOGIN,
  API_ENDPOINTS.AUTH.REGISTER,
  API_ENDPOINTS.AUTH.REFRESH,
]);

function isAuthFree(config: InternalAxiosRequestConfig): boolean {
  return AUTH_FREE_PATHS.has(config.url ?? '');
}

http.interceptors.request.use(
  async (config) => {
    if (isAuthFree(config)) return config;

    // Refresh proactively when the token is about to expire; otherwise the
    // 401 path below handles it reactively.
    const token = (await ensureFreshAccessToken()) ?? getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    if (error.response?.status === 401 && config && !config._retried && !isAuthFree(config)) {
      config._retried = true;
      try {
        // Ten parallel 401s → one refresh (singleFlight inside refreshSession).
        const token = await refreshSession();
        config.headers.Authorization = `Bearer ${token}`;
        return http.request(config);
      } catch (e) {
        if (!(e instanceof SessionLostError)) {
          console.warn('[http] refresh failed, will retry later:', (e as Error)?.message ?? e);
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);
