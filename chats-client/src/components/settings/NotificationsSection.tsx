import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import SectionEyebrow from '../SectionEyebrow';
import StatusChip from '../StatusChip';
import { InfoNote, SettingsGroup, SettingsRow, SettingsToggle } from './primitives';
import {
  disablePushMessaging,
  getNotificationDeviceStatus,
  openSystemNotificationSettings,
  requestNotificationPermission,
  type NotificationDeviceStatus,
} from '../../shared/notifications/push';
import {
  syncPushTokenWithServer,
  unregisterPushTokenFromServer,
} from '../../shared/notifications/sync';
import {
  getNotificationPreferencesForUser,
  useNotificationPreferencesStore,
} from '../../store/notification-preferences.store';

/**
 * Settings → Notifications: push on/off with the device's permission and
 * registration state, and the in-app alert preferences. Self-contained:
 * it loads the device status on mount and on focus.
 */
export default function NotificationsSection({ userId }: { userId: string | null }) {
  const notificationPreferencesByUserId = useNotificationPreferencesStore(
    (s) => s.preferencesByUserId,
  );
  const setUserNotificationPreferences = useNotificationPreferencesStore(
    (s) => s.setUserNotificationPreferences,
  );
  const [notificationStatus, setNotificationStatus] = useState<NotificationDeviceStatus | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  const notificationPreferences = useMemo(
    () => getNotificationPreferencesForUser(notificationPreferencesByUserId, userId),
    [notificationPreferencesByUserId, userId],
  );

  const loadNotificationStatus = useCallback(async () => {
    setNotificationLoading(true);
    try {
      const nextStatus = await getNotificationDeviceStatus(notificationPreferences.pushEnabled);
      setNotificationStatus(nextStatus);
    } catch (error) {
      console.warn('[Settings] Failed to load notification status:', error);
      setNotificationStatus(null);
    } finally {
      setNotificationLoading(false);
    }
  }, [notificationPreferences.pushEnabled]);

  useEffect(() => {
    loadNotificationStatus();
  }, [loadNotificationStatus]);

  useFocusEffect(
    useCallback(() => {
      loadNotificationStatus();
    }, [loadNotificationStatus]),
  );

  const updateNotificationPreferences = useCallback(
    (patch: Parameters<typeof setUserNotificationPreferences>[1]) => {
      if (!userId) return;
      setUserNotificationPreferences(userId, patch);
    },
    [setUserNotificationPreferences, userId],
  );

  const handleNotificationPermissionPress = useCallback(async () => {
    setNotificationMessage(null);

    if (
      notificationStatus?.permissionStatus === 'granted' ||
      notificationStatus?.permissionStatus === 'provisional' ||
      notificationStatus?.permissionStatus === 'ephemeral'
    ) {
      await openSystemNotificationSettings();
      return;
    }

    const status = await requestNotificationPermission();
    if (status === 'granted' || status === 'provisional' || status === 'ephemeral') {
      try {
        await syncPushTokenWithServer(notificationPreferences.pushEnabled);
      } catch (error) {
        console.warn('[Settings] Failed to sync push token after permission grant:', error);
      }
      setNotificationMessage('Notifications are now allowed for this device.');
    } else {
      setNotificationMessage('Notifications are still blocked at the system level.');
    }

    await loadNotificationStatus();
  }, [
    loadNotificationStatus,
    notificationPreferences.pushEnabled,
    notificationStatus?.permissionStatus,
  ]);

  const handlePushToggle = useCallback(
    async (enabled: boolean) => {
      if (!userId) return;

      updateNotificationPreferences({ pushEnabled: enabled });
      setNotificationMessage(
        enabled
          ? 'Push delivery is enabled for this device.'
          : 'Push delivery was disabled and the local device token was cleared.',
      );

      if (!enabled) {
        await unregisterPushTokenFromServer(true);
        await disablePushMessaging();
      } else {
        try {
          await syncPushTokenWithServer(true);
        } catch (error) {
          console.warn('[Settings] Failed to sync push token:', error);
        }
      }

      await loadNotificationStatus();
    },
    [loadNotificationStatus, updateNotificationPreferences, userId],
  );

  const notificationPermissionValue = notificationLoading
    ? 'Checking'
    : notificationStatus?.permissionStatus === 'granted'
      ? 'Allowed'
      : notificationStatus?.permissionStatus === 'provisional'
        ? 'Provisional'
        : notificationStatus?.permissionStatus === 'ephemeral'
          ? 'Ephemeral'
          : notificationStatus?.permissionStatus === 'not-determined'
            ? 'Not asked'
            : 'Blocked';

  const notificationPermissionDescription = notificationLoading
    ? 'Checking whether this device can display push notifications.'
    : notificationStatus?.permissionStatus === 'granted'
      ? 'This device is allowed to display push notifications for the app.'
      : notificationStatus?.permissionStatus === 'provisional'
        ? 'Notifications are provisionally allowed and can be promoted in system settings.'
        : notificationStatus?.permissionStatus === 'ephemeral'
          ? 'Temporary notification authorization is available on this device.'
          : notificationStatus?.permissionStatus === 'not-determined'
            ? 'The app has not asked for notification permission yet.'
            : 'Notifications are blocked at the OS level until you re-enable them.';

  const pushTokenValue = notificationLoading
    ? 'Checking'
    : notificationStatus?.tokenReady
      ? 'Working'
      : 'Not registered';

  const pushTokenDescription = notificationLoading
    ? 'Checking whether this phone can receive alerts in the background.'
    : notificationPreferences.pushEnabled
      ? notificationStatus?.tokenReady
        ? 'This phone can receive new-message alerts while the app is closed.'
        : 'Push is on, but this phone has not registered for alerts yet. Tap to try again.'
      : 'Push is off, so this phone is not registered for background alerts.';

  return (
    <>
      <SectionEyebrow
        title="Notifications"
        description="Messaging alerts and attention behavior."
      />
      <SettingsGroup>
        <SettingsRow
          title="Push notifications"
          subtitle="Get alerted about new messages while the app is closed."
          onPress={() => handlePushToggle(!notificationPreferences.pushEnabled)}
          trailing={
            <SettingsToggle
              value={notificationPreferences.pushEnabled}
              onValueChange={handlePushToggle}
            />
          }
        />
        <SettingsRow
          title="System permission"
          subtitle={notificationPermissionDescription}
          onPress={handleNotificationPermissionPress}
          trailing={
            <StatusChip
              label={notificationPermissionValue}
              tone={
                notificationPermissionValue === 'Allowed' ||
                notificationPermissionValue === 'Provisional' ||
                notificationPermissionValue === 'Ephemeral'
                  ? 'success'
                  : notificationPermissionValue === 'Checking'
                    ? 'neutral'
                    : 'warning'
              }
            />
          }
        />
        <SettingsRow
          title="Background alerts"
          subtitle={pushTokenDescription}
          onPress={loadNotificationStatus}
          trailing={
            <StatusChip
              label={pushTokenValue}
              tone={pushTokenValue === 'Working' ? 'success' : pushTokenValue === 'Checking' ? 'neutral' : 'warning'}
            />
          }
        />
        <SettingsRow
          title="In-app alerts"
          subtitle="Show app-side message alerts while you are already inside the messenger."
          onPress={() =>
            updateNotificationPreferences({
              inAppAlertsEnabled: !notificationPreferences.inAppAlertsEnabled,
            })
          }
          trailing={
            <SettingsToggle
              value={notificationPreferences.inAppAlertsEnabled}
              onValueChange={(value) =>
                updateNotificationPreferences({ inAppAlertsEnabled: value })
              }
            />
          }
        />
        <SettingsRow
          title="Message previews"
          subtitle="Include message text in notifications instead of only showing the sender."
          onPress={() =>
            updateNotificationPreferences({
              showMessagePreview: !notificationPreferences.showMessagePreview,
            })
          }
          trailing={
            <SettingsToggle
              value={notificationPreferences.showMessagePreview}
              onValueChange={(value) =>
                updateNotificationPreferences({ showMessagePreview: value })
              }
            />
          }
        />
        <SettingsRow
          title="Sound"
          subtitle="Play a sound when a new message alert is shown."
          onPress={() =>
            updateNotificationPreferences({
              soundEnabled: !notificationPreferences.soundEnabled,
            })
          }
          trailing={
            <SettingsToggle
              value={notificationPreferences.soundEnabled}
              onValueChange={(value) =>
                updateNotificationPreferences({ soundEnabled: value })
              }
            />
          }
        />
        <SettingsRow
          title="Vibration"
          subtitle="Use vibration together with message alerts on supported devices."
          onPress={() =>
            updateNotificationPreferences({
              vibrationEnabled: !notificationPreferences.vibrationEnabled,
            })
          }
          trailing={
            <SettingsToggle
              value={notificationPreferences.vibrationEnabled}
              onValueChange={(value) =>
                updateNotificationPreferences({ vibrationEnabled: value })
              }
            />
          }
          last
        />
      </SettingsGroup>
      {notificationMessage ? <InfoNote>{notificationMessage}</InfoNote> : null}
    </>
  );
}
