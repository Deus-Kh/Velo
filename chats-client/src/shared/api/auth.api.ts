import { http } from './http';
import { API_ENDPOINTS } from './endpoints';
import { LoginRequest, RegisterRequest, AuthResponse, ChangePasswordRequest } from './auth.types';

export const authApi = {
  login: (data: LoginRequest) => http.post<AuthResponse>(API_ENDPOINTS.AUTH.LOGIN,data),
    // http.post<AuthResponse>(API_ENDPOINTS.AUTH.LOGIN, JSON.stringify(data)),

  register: (data: RegisterRequest) =>
    http.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, data),

  changePassword: (data: ChangePasswordRequest) =>
    http.post<{ ok: boolean } & Partial<AuthResponse>>(API_ENDPOINTS.AUTH.CHANGE_PASSWORD, data),

  /** Revokes the refresh-token family on the server. Best effort at logout. */
  logout: (refreshToken: string | null) =>
    http.post<{ ok: boolean }>(API_ENDPOINTS.AUTH.LOGOUT, refreshToken ? { refreshToken } : {}),
};
