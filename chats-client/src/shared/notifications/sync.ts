import { Platform } from 'react-native';
import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging';

import { userApi } from '../api/user.api';
import { getNotificationDeviceStatus } from './push';
import {
  getNotificationPreferencesForUser,
  useNotificationPreferencesStore,
} from '../../store/notification-preferences.store';

function getPushPlatform() {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export async function syncPushTokenWithServer(pushEnabled: boolean) {
  const status = await getNotificationDeviceStatus(pushEnabled);

  if (!pushEnabled || !status.token) {
    return null;
  }

  await userApi.registerPushToken({
    token: status.token,
    platform: getPushPlatform(),
  });

  return status.token;
}

export async function unregisterPushTokenFromServer(pushEnabled: boolean) {
  const status = await getNotificationDeviceStatus(pushEnabled);
  if (!status.token) return;
  await userApi.unregisterPushToken(status.token);
}

export function startPushTokenRefreshSync(userId: string) {
  const messaging = getMessaging();

  return onTokenRefresh(messaging, async (token) => {
    try {
      const preferences = getNotificationPreferencesForUser(
        useNotificationPreferencesStore.getState().preferencesByUserId,
        userId,
      );

      if (!preferences.pushEnabled || !token) {
        return;
      }

      await userApi.registerPushToken({
        token,
        platform: getPushPlatform(),
      });
    } catch (error) {
      console.warn('[notifications] failed to sync refreshed FCM token:', error);
    }
  });
}
