import { Linking, PermissionsAndroid, Platform } from 'react-native';
import {
  AuthorizationStatus,
  deleteToken,
  getMessaging,
  getToken,
  hasPermission,
  isDeviceRegisteredForRemoteMessages,
  registerDeviceForRemoteMessages,
  requestPermission,
} from '@react-native-firebase/messaging';

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'provisional'
  | 'ephemeral'
  | 'unavailable';

export type NotificationDeviceStatus = {
  permissionStatus: NotificationPermissionState;
  token: string | null;
  tokenReady: boolean;
};

function getMessagingInstance() {
  return getMessaging();
}

function mapFirebaseAuthorizationStatus(
  status: number,
): NotificationPermissionState {
  switch (status) {
    case AuthorizationStatus.AUTHORIZED:
      return 'granted';
    case AuthorizationStatus.PROVISIONAL:
      return 'provisional';
    case AuthorizationStatus.EPHEMERAL:
      return 'ephemeral';
    case AuthorizationStatus.DENIED:
      return 'denied';
    case AuthorizationStatus.NOT_DETERMINED:
      return 'not-determined';
    default:
      return 'unavailable';
  }
}

function canReceivePush(permissionStatus: NotificationPermissionState) {
  return (
    permissionStatus === 'granted' ||
    permissionStatus === 'provisional' ||
    permissionStatus === 'ephemeral'
  );
}

async function getAndroidNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  const androidVersion =
    typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);

  if (androidVersion < 33) {
    return 'granted';
  }

  const granted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return granted ? 'granted' : 'denied';
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'android') {
    return getAndroidNotificationPermissionStatus();
  }

  const status = await hasPermission(getMessagingInstance());
  return mapFirebaseAuthorizationStatus(status);
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'android') {
    const androidVersion =
      typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);

    if (androidVersion < 33) {
      return 'granted';
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );

    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  }

  const status = await requestPermission(getMessagingInstance());
  return mapFirebaseAuthorizationStatus(status);
}

async function ensureMessagingToken(): Promise<string | null> {
  const messagingInstance = getMessagingInstance();

  if (
    Platform.OS === 'ios' &&
    !isDeviceRegisteredForRemoteMessages(messagingInstance)
  ) {
    await registerDeviceForRemoteMessages(messagingInstance);
  }

  return getToken(messagingInstance);
}

export async function disablePushMessaging(): Promise<void> {
  try {
    await deleteToken(getMessagingInstance());
  } catch (error) {
    console.warn('[notifications] failed to delete FCM token:', error);
  }
}

export async function getNotificationDeviceStatus(
  pushEnabled: boolean,
): Promise<NotificationDeviceStatus> {
  const permissionStatus = await getNotificationPermissionStatus();

  if (!pushEnabled || !canReceivePush(permissionStatus)) {
    return {
      permissionStatus,
      token: null,
      tokenReady: false,
    };
  }

  try {
    const token = await ensureMessagingToken();
    return {
      permissionStatus,
      token,
      tokenReady: Boolean(token),
    };
  } catch (error) {
    console.warn('[notifications] failed to get FCM token:', error);
    return {
      permissionStatus,
      token: null,
      tokenReady: false,
    };
  }
}

export async function openSystemNotificationSettings() {
  await Linking.openSettings();
}
