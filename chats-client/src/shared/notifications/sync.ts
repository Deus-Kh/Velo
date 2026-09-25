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

/**
 * Removes this device's FCM token from the account on the server.
 *
 * Always resolves the token regardless of the user's push preference: a user
 * who disabled push and then logs out must not leave a live token registered
 * against a device that is no longer signed in. (The old `pushEnabled`
 * argument short-circuited exactly that case.)
 */
export async function unregisterPushTokenFromServer(_pushEnabled?: boolean) {
  const status = await getNotificationDeviceStatus(true);
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
