import { http } from './http';
import { API_ENDPOINTS } from './endpoints';

export interface PublicKeyResponse {
  userId: string;
  publicKey: string; // base64
}
export interface MeResponse {
  userId: string;
  username: string;
  email: string;
  publicKey?: string | null;
}
export interface UserListItem {
  userId: string;
  username: string;
  email: string;
  hasPublicKey: boolean;
}
export interface UsersListResponse {
  items: UserListItem[];
}

export interface UpdateMeRequest {
  username: string;
  email: string;
}

export interface PushTokenRequest {
  token: string;
  platform: 'android' | 'ios';
}

export const userApi = {
  uploadPublicKey: (publicKey: string) =>
    http.post(API_ENDPOINTS.USER.PUBLIC_KEY, { publicKey }),

  getMe: () => http.get<MeResponse>(API_ENDPOINTS.USER.ME),

  updateMe: (data: UpdateMeRequest) => http.patch<MeResponse>(API_ENDPOINTS.USER.ME, data),

  registerPushToken: (data: PushTokenRequest) =>
    http.post<{ ok: true }>(API_ENDPOINTS.USER.PUSH_TOKEN, data),

  unregisterPushToken: (token: string) =>
    http.delete<{ ok: true }>(API_ENDPOINTS.USER.PUSH_TOKEN, { data: { token } }),

  getPublicKeyByUserId: (userId: string) =>
    http.get<PublicKeyResponse>(
      `${API_ENDPOINTS.USER.PUBLIC_KEY_BY_ID}${userId}`
    ),
    getUsers: (params?: { q?: string; limit?: number }) =>
    http.get<UsersListResponse>('/users', { params }),
};
