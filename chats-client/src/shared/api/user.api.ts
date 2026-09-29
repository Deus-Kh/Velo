import { http } from './http';
import { API_ENDPOINTS } from './endpoints';

export interface PublicKeyResponse {
  userId: string;
  publicKey: string; // base64
}
/** T7.4: what peers may learn; enforced by the server. */
export interface PrivacySettings {
  readReceipts: boolean;
  typing: boolean;
  lastSeen: boolean;
  online: boolean;
}
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = { readReceipts: true, typing: true, lastSeen: false, online: false };

export interface MeResponse {
  userId: string;
  username: string;
  email: string;
  publicKey?: string | null;
  privacy?: PrivacySettings;
}
/** A search result. Deliberately carries no email (T1.6): other users' emails are never exposed. */
export interface UserListItem {
  userId: string;
  username: string;
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

  getPrivacy: () => http.get<PrivacySettings>('/users/me/privacy'),
  updatePrivacy: (patch: Partial<PrivacySettings>) => http.patch<PrivacySettings>('/users/me/privacy', patch),
};
