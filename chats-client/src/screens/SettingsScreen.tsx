import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import ScreenHeader from '../components/ScreenHeader';
import SectionEyebrow from '../components/SectionEyebrow';
import StatusChip from '../components/StatusChip';
import { useAuthStore } from '../store/auth.store';
import { deleteAllSessionsForUser } from '../shared/storage/sessionStore';
import { authApi } from '../shared/api/auth.api';
import { userApi, type MeResponse } from '../shared/api/user.api';
import {
  disablePushMessaging,
  getNotificationDeviceStatus,
  openSystemNotificationSettings,
  requestNotificationPermission,
  type NotificationDeviceStatus,
} from '../shared/notifications/push';
import {
  syncPushTokenWithServer,
  unregisterPushTokenFromServer,
} from '../shared/notifications/sync';
import {
  useAppearanceStore,
  type ThemePreference,
  type InterfaceDensity,
  type SurfaceStyle,
} from '../store/appearance.store';
import {
  getNotificationPreferencesForUser,
  useNotificationPreferencesStore,
} from '../store/notification-preferences.store';

type SecurityDiagnostics = {
  identityKeyReady: boolean;
  identityDhReady: boolean;
  signedPreKeyReady: boolean;
  historyMasterKeyReady: boolean;
  sessionCount: number;
  trustedContactsCount: number;
  cachedMessageKeysCount: number;
  oneTimePreKeysCount: number;
};

type EditableProfile = Pick<MeResponse, 'username' | 'email'>;
type EditableProfileField = keyof EditableProfile | null;
type PasswordDraft = {
  currentPassword: string;
  newPassword: string;
};

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-3 overflow-hidden rounded-[22px] border border-border bg-surface/92">
      {children}
    </View>
  );
}

function SettingsRow({
  title,
  subtitle,
  value,
  danger,
  onPress,
  trailing,
  last,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void | Promise<void>;
  trailing?: React.ReactNode;
  last?: boolean;
}) {
  const textTone = danger ? 'text-danger' : 'text-text';

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className={`${last ? '' : 'border-b border-border'} px-4 py-3.5 ${onPress ? 'active:opacity-80' : ''}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className={`text-[15px] font-medium ${textTone}`}>{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</Text>
          ) : null}
        </View>

        {value ? (
          <Text className={`text-[13px] ${danger ? 'text-danger' : 'text-muted'}`}>{value}</Text>
        ) : null}

        {trailing ? trailing : onPress ? <Text className="text-base text-muted">›</Text> : null}
      </View>
    </Pressable>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-3 rounded-[18px] border border-border bg-background-alt/70 px-4 py-3">
      <Text className="text-[13px] leading-6 text-muted">{children}</Text>
    </View>
  );
}

function ThemeModeSelector({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const options: { key: ThemePreference; label: string }[] = [
    { key: 'system', label: 'System' },
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
  ];

  return (
    <View className="mt-3 flex-row rounded-[18px] border border-border bg-background-alt/70 p-1">
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            className={`flex-1 items-center rounded-[14px] px-3 py-2.5 active:opacity-80 ${
              active ? 'bg-surface-elevated' : ''
            }`}
          >
            <Text className={`text-[13px] font-medium ${active ? 'text-text' : 'text-muted'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SegmentedSelector<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <View className="mt-3 flex-row rounded-[18px] border border-border bg-background-alt/70 p-1">
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            className={`flex-1 items-center rounded-[14px] px-3 py-2.5 active:opacity-80 ${
              active ? 'bg-surface-elevated' : ''
            }`}
          >
            <Text className={`text-[13px] font-medium ${active ? 'text-text' : 'text-muted'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SettingsToggle({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: '#CBD5E1', true: '#67E8F9' }}
      thumbColor={value ? '#0F172A' : '#FFFFFF'}
      ios_backgroundColor="#CBD5E1"
    />
  );
}

function maskUserId(userId: string | null) {
  if (!userId) return 'Local session';
  if (userId.length <= 10) return userId;
  return `${userId.slice(0, 6)}...${userId.slice(-4)}`;
}

function AccountHero({
  profile,
  userId,
  keyStateValue,
  encryptionValue,
}: {
  profile: MeResponse | null;
  userId: string | null;
  keyStateValue: string;
  encryptionValue: string;
}) {
  return (
    <View className="mt-5 rounded-[28px] border border-border bg-surface/92 p-5">
      <Text className="text-[11px] font-semibold uppercase tracking-[1.3px] text-primary">
        Secure Profile
      </Text>
      <View className="mt-4 flex-row items-center">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
          <Text className="text-lg font-semibold text-primary">
            {(profile?.username ?? userId ?? 'U').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View className="ml-4 flex-1">
          <Text className="text-lg font-semibold text-text">
            {profile?.username || (userId ? `User ${maskUserId(userId)}` : 'Signed in on this device')}
          </Text>
          <Text className="mt-1 text-sm leading-6 text-muted">
            {profile?.email || 'Privacy, keys and local secure sessions are isolated to this account.'}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2">
        <StatusChip
          label={keyStateValue === 'Ready' ? 'Keys ready' : keyStateValue}
          tone={keyStateValue === 'Ready' ? 'success' : 'warning'}
        />
        <StatusChip
          label={encryptionValue === 'Enabled' ? 'History protected' : encryptionValue}
          tone={encryptionValue === 'Enabled' ? 'success' : 'warning'}
        />
        <StatusChip label="Single device" />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const logout = useAuthStore((s) => s.logout);
  const userId = useAuthStore((s) => s.userId);
  const themePreference = useAppearanceStore((s) => s.themePreference);
  const setThemePreference = useAppearanceStore((s) => s.setThemePreference);
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const setInterfaceDensity = useAppearanceStore((s) => s.setInterfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const setSurfaceStyle = useAppearanceStore((s) => s.setSurfaceStyle);
  const notificationPreferencesByUserId = useNotificationPreferencesStore(
    (s) => s.preferencesByUserId,
  );
  const setUserNotificationPreferences = useNotificationPreferencesStore(
    (s) => s.setUserNotificationPreferences,
  );

  const [isResettingSecurity, setIsResettingSecurity] = useState(false);
  const [securityResetStatus, setSecurityResetStatus] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SecurityDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editingField, setEditingField] = useState<EditableProfileField>(null);
  const [profileDraft, setProfileDraft] = useState<EditableProfile>({
    username: '',
    email: '',
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    currentPassword: '',
    newPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationDeviceStatus | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  const notificationPreferences = useMemo(
    () => getNotificationPreferencesForUser(notificationPreferencesByUserId, userId),
    [notificationPreferencesByUserId, userId],
  );

  const loadDiagnostics = useCallback(async () => {
    if (!userId) {
      setDiagnostics(null);
      setDiagnosticsLoading(false);
      return;
    }

    setDiagnosticsLoading(true);

    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const [
        identityKeyCreds,
        identityDhCreds,
        signedPreKeyCreds,
        historyMasterKeyCreds,
      ] = await Promise.all([
        Keychain.getGenericPassword({ service: `identity-sign:${userId}` }),
        Keychain.getGenericPassword({ service: `identity-dh:${userId}` }),
        Keychain.getGenericPassword({ service: `signed-prekey:${userId}` }),
        Keychain.getGenericPassword({ service: `history-mk:${userId}` }),
      ]);

      setDiagnostics({
        identityKeyReady: Boolean(identityKeyCreds),
        identityDhReady: Boolean(identityDhCreds),
        signedPreKeyReady: Boolean(signedPreKeyCreds),
        historyMasterKeyReady: Boolean(historyMasterKeyCreds),
        sessionCount: allKeys.filter((key) => key.startsWith(`session:v2:${userId}:`)).length,
        trustedContactsCount: allKeys.filter((key) => key.startsWith(`trusted-identity:${userId}:`)).length,
        cachedMessageKeysCount: allKeys.filter((key) => key.startsWith(`v2mk:${userId}:`)).length,
        oneTimePreKeysCount: allKeys.filter((key) => key.startsWith(`otpk:${userId}:`)).length,
      });
    } catch (error) {
      console.warn('[Settings] Failed to load secure diagnostics:', error);
      setDiagnostics(null);
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [userId]);

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    try {
      const res = await userApi.getMe();
      setProfile(res.data);
      setProfileDraft({
        username: res.data.username,
        email: res.data.email,
      });
      setProfileError(null);
    } catch (error: any) {
      console.warn('[Settings] Failed to load profile:', error);
      setProfileError(error?.response?.data?.error || error?.message || 'Failed to load profile');
    } finally {
      setProfileLoading(false);
    }
  }, [userId]);

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
    loadDiagnostics();
  }, [loadDiagnostics]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    loadNotificationStatus();
  }, [loadNotificationStatus]);

  useFocusEffect(
    useCallback(() => {
      loadDiagnostics();
      loadProfile();
      loadNotificationStatus();
    }, [loadDiagnostics, loadNotificationStatus, loadProfile]),
  );

  const resetLocalSecurityState = async () => {
    if (!userId || isResettingSecurity) return;

    setIsResettingSecurity(true);
    setSecurityResetStatus(null);

    try {
      await deleteAllSessionsForUser(userId);

      const allKeys = await AsyncStorage.getAllKeys();
      const removablePrefixes = [
        `trusted-identity:${userId}:`,
        `v2mk:${userId}:`,
        `otpk:${userId}:`,
      ];

      const toRemove = allKeys.filter((key) =>
        removablePrefixes.some((prefix) => key.startsWith(prefix)),
      );

      if (toRemove.length) {
        await AsyncStorage.multiRemove(toRemove);
      }

      await Promise.allSettled([
        Keychain.resetGenericPassword({ service: `history-mk:${userId}` }),
        Keychain.resetGenericPassword({ service: `identity-sign:${userId}` }),
        Keychain.resetGenericPassword({ service: `identity-dh:${userId}` }),
        Keychain.resetGenericPassword({ service: `signed-prekey:${userId}` }),
      ]);

      setSecurityResetStatus('Local secure state was cleared for this account.');
      await loadDiagnostics();
    } catch (error) {
      console.warn('[Settings] Failed to reset local secure state:', error);
      setSecurityResetStatus('Failed to clear local secure state. Please try again.');
    } finally {
      setIsResettingSecurity(false);
    }
  };

  const keyStateValue = diagnosticsLoading
    ? 'Checking'
    : diagnostics?.identityKeyReady && diagnostics?.identityDhReady
      ? 'Ready'
      : 'Missing';

  const encryptionValue = diagnosticsLoading
    ? 'Checking'
    : diagnostics?.historyMasterKeyReady
      ? 'Enabled'
      : 'Preparing';

  const cancelProfileEditing = useCallback(() => {
    setEditingField(null);
    setProfileError(null);
    setProfileDraft({
      username: profile?.username || '',
      email: profile?.email || '',
    });
  }, [profile?.email, profile?.username]);

  const saveProfile = useCallback(async () => {
    const nextUsername = profileDraft.username.trim();
    const nextEmail = profileDraft.email.trim().toLowerCase();

    if (!nextUsername || !nextEmail) {
      setProfileError('Username and email are required.');
      return;
    }

    setProfileSaving(true);
    setProfileError(null);
    setProfileStatus(null);

    try {
      const res = await userApi.updateMe({
        username: nextUsername,
        email: nextEmail,
      });

      setProfile(res.data);
      setProfileDraft({
        username: res.data.username,
        email: res.data.email,
      });
      setProfileStatus('Profile updated for this account.');
      setEditingField(null);
    } catch (error: any) {
      setProfileError(error?.response?.data?.error || error?.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  }, [profileDraft.email, profileDraft.username]);

  const cancelPasswordEditing = useCallback(() => {
    setEditingPassword(false);
    setPasswordError(null);
    setPasswordDraft({
      currentPassword: '',
      newPassword: '',
    });
  }, []);

  const savePassword = useCallback(async () => {
    if (!passwordDraft.currentPassword || !passwordDraft.newPassword) {
      setPasswordError('Current password and new password are required.');
      return;
    }

    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordStatus(null);

    try {
      await authApi.changePassword({
        currentPassword: passwordDraft.currentPassword,
        newPassword: passwordDraft.newPassword,
      });
      setPasswordStatus('Password updated for this account.');
      setPasswordDraft({
        currentPassword: '',
        newPassword: '',
      });
      setEditingPassword(false);
    } catch (error: any) {
      setPasswordError(
        error?.response?.data?.error || error?.message || 'Failed to change password',
      );
    } finally {
      setPasswordSaving(false);
    }
  }, [passwordDraft.currentPassword, passwordDraft.newPassword]);

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
      ? 'Ready'
      : 'Missing';

  const pushTokenDescription = notificationLoading
    ? 'Checking whether this installation already has a push token.'
    : notificationPreferences.pushEnabled
      ? notificationStatus?.tokenReady
        ? 'This installation has an FCM device token and is ready for server-side push wiring.'
        : 'Push is enabled locally, but this installation does not currently have a device token.'
      : 'Push delivery is turned off locally, so the device token is intentionally cleared.';

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 6,
          paddingBottom: Math.max(insets.bottom + 28, 36),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-4">
          <ScreenHeader
            title="Settings"
            subtitle="Account, privacy, encryption and device preferences for this messenger."
          />
          <AccountHero
            profile={profile}
            userId={userId}
            keyStateValue={keyStateValue}
            encryptionValue={encryptionValue}
          />

          <SectionEyebrow
            title="Profile"
            description="Identity and account context for the current device session."
          />
          <SettingsGroup>
            {editingField === 'username' ? (
              <View className="border-b border-border px-4 py-3.5">
                <Text className="text-[15px] font-medium text-text">Display name</Text>
                <TextInput
                  value={profileDraft.username}
                  onChangeText={(value) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      username: value,
                    }))
                  }
                  placeholder="Username"
                  placeholderTextColor="#94A3B8"
                  className="mt-2 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 text-[14px] text-text"
                  autoCapitalize="none"
                />
                <View className="mt-3 flex-row gap-3">
                  <Pressable
                    onPress={saveProfile}
                    disabled={profileSaving}
                    className="flex-1 rounded-[14px] bg-primary px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-semibold text-background">
                      {profileSaving ? 'Saving...' : 'Save'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={cancelProfileEditing}
                    className="flex-1 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-medium text-text">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <SettingsRow
                title="Display name"
                subtitle={profileLoading ? 'Loading profile...' : profile?.username || 'Not available'}
                onPress={() => {
                  setProfileStatus(null);
                  setProfileError(null);
                  setEditingField('username');
                }}
                value="Edit"
              />
            )}
            {editingField === 'email' ? (
              <View className="border-b border-border px-4 py-3.5">
                <Text className="text-[15px] font-medium text-text">Email</Text>
                <TextInput
                  value={profileDraft.email}
                  onChangeText={(value) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      email: value,
                    }))
                  }
                  placeholder="Email"
                  placeholderTextColor="#94A3B8"
                  className="mt-2 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 text-[14px] text-text"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <View className="mt-3 flex-row gap-3">
                  <Pressable
                    onPress={saveProfile}
                    disabled={profileSaving}
                    className="flex-1 rounded-[14px] bg-primary px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-semibold text-background">
                      {profileSaving ? 'Saving...' : 'Save'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={cancelProfileEditing}
                    className="flex-1 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-medium text-text">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <SettingsRow
                title="Email"
                subtitle={profileLoading ? 'Loading email...' : profile?.email || 'Not available'}
                onPress={() => {
                  setProfileStatus(null);
                  setProfileError(null);
                  setEditingField('email');
                }}
                value="Edit"
              />
            )}
            <SettingsRow
              title="Account ID"
              subtitle={userId ? maskUserId(userId) : 'Signed in on this device'}
              value="Current"
              last
            />
          </SettingsGroup>
          {profileError ? <InfoNote>{profileError}</InfoNote> : null}
          {profileStatus ? <InfoNote>{profileStatus}</InfoNote> : null}

          <SectionEyebrow
            title="Privacy"
            description="Controls and explanations related to identity trust and secure communication."
          />
          <SettingsGroup>
            <SettingsRow
              title="Trusted contacts"
              subtitle="Contacts you explicitly verified on this device."
              value={diagnosticsLoading ? 'Checking' : `${diagnostics?.trustedContactsCount ?? 0}`}
            />
            <SettingsRow
              title="Verification flow"
              subtitle="Identity verification is available inside each chat before marking a contact as trusted."
              value="In chats"
            />
            <SettingsRow
              title="Security explanations"
              subtitle="The app explains encryption state in human language instead of protocol jargon."
              value="Enabled"
              last
            />
          </SettingsGroup>

          <SectionEyebrow
            title="Encryption"
            description="State of local keys, ratchet sessions and message protection on this device."
          />
          <SettingsGroup>
            <SettingsRow
              title="Identity key state"
              subtitle="Signing and Diffie-Hellman identity keys for this account."
              value={keyStateValue}
              trailing={
                <StatusChip
                  label={keyStateValue}
                  tone={keyStateValue === 'Ready' ? 'success' : 'warning'}
                />
              }
            />
            <SettingsRow
              title="History protection"
              subtitle="Local message key cache is wrapped with a dedicated secure storage master key."
              trailing={
                <StatusChip
                  label={encryptionValue}
                  tone={encryptionValue === 'Enabled' ? 'success' : 'warning'}
                />
              }
            />
            <SettingsRow
              title="Secure sessions"
              subtitle="Active local ratchet sessions currently stored for chats on this device."
              value={diagnosticsLoading ? 'Checking' : `${diagnostics?.sessionCount ?? 0}`}
            />
            <SettingsRow
              title="Cached message keys"
              subtitle="Stored encrypted message keys used to safely decrypt older history."
              value={diagnosticsLoading ? 'Checking' : `${diagnostics?.cachedMessageKeysCount ?? 0}`}
            />
            <SettingsRow
              title="Prekeys"
              subtitle="Signed prekey and local one-time prekeys available for secure bootstrap."
              value={
                diagnosticsLoading
                  ? 'Checking'
                  : diagnostics?.signedPreKeyReady
                    ? `${diagnostics?.oneTimePreKeysCount ?? 0} local`
                    : 'Missing'
              }
              last
            />
          </SettingsGroup>

          <SectionEyebrow
            title="Devices & Sessions"
            description="Current device session and local recovery actions."
          />
          <SettingsGroup>
            <SettingsRow
              title="Current device"
              subtitle="You are signed in locally and encrypted messaging restores automatically after reconnect."
              trailing={<StatusChip label="Connected" tone="success" />}
            />
            <SettingsRow
              title="Refresh security state"
              subtitle="Re-scan local keys and session artifacts after resets or recovery steps."
              onPress={loadDiagnostics}
              value={diagnosticsLoading ? 'Refreshing' : 'Refresh'}
            />
            <SettingsRow
              title="Reset local secure state"
              subtitle="Clears local sessions, trusted identities, cached message keys and local crypto secrets for this account."
              onPress={resetLocalSecurityState}
              value={isResettingSecurity ? 'Resetting' : 'Clear'}
              danger
              last
            />
          </SettingsGroup>
          {securityResetStatus ? <InfoNote>{securityResetStatus}</InfoNote> : null}

          <SectionEyebrow
            title="Notifications"
            description="Messaging alerts and attention behavior."
          />
          <SettingsGroup>
            <SettingsRow
              title="Push notifications"
              subtitle="Allow this device to keep a push token for background message delivery."
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
              title="Device token"
              subtitle={pushTokenDescription}
              onPress={loadNotificationStatus}
              trailing={
                <StatusChip
                  label={pushTokenValue}
                  tone={pushTokenValue === 'Ready' ? 'success' : 'warning'}
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

          <SectionEyebrow
            title="Appearance"
            description="Visual preferences for messenger density and atmosphere."
          />
          <SettingsGroup>
            <SettingsRow
              title="Theme"
              subtitle="Choose whether the app follows the system theme or always stays light or dark."
            />
            <View className="px-4 pb-3">
              <ThemeModeSelector value={themePreference} onChange={setThemePreference} />
            </View>
            <SettingsRow
              title="Interface density"
              subtitle="Choose how tight or airy the messenger layout feels across chats and lists."
            />
            <View className="px-4 pb-3">
              <SegmentedSelector<InterfaceDensity>
                value={interfaceDensity}
                onChange={setInterfaceDensity}
                options={[
                  { key: 'compact', label: 'Compact' },
                  { key: 'comfortable', label: 'Comfort' },
                ]}
              />
            </View>
            <SettingsRow
              title="Surface style"
              subtitle="Switch between cleaner solid panels and lighter glass-like translucent surfaces."
              last
            />
            <View className="px-4 pb-3">
              <SegmentedSelector<SurfaceStyle>
                value={surfaceStyle}
                onChange={setSurfaceStyle}
                options={[
                  { key: 'glass', label: 'Glass' },
                  { key: 'solid', label: 'Solid' },
                ]}
              />
            </View>
          </SettingsGroup>

          <SectionEyebrow
            title="Account"
            description="Session-ending actions for this device."
          />
          <SettingsGroup>
            {editingPassword ? (
              <View className="border-b border-border px-4 py-3.5">
                <Text className="text-[15px] font-medium text-text">Change password</Text>
                <TextInput
                  value={passwordDraft.currentPassword}
                  onChangeText={(value) =>
                    setPasswordDraft((prev) => ({
                      ...prev,
                      currentPassword: value,
                    }))
                  }
                  placeholder="Current password"
                  placeholderTextColor="#94A3B8"
                  className="mt-2 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 text-[14px] text-text"
                  secureTextEntry
                />
                <TextInput
                  value={passwordDraft.newPassword}
                  onChangeText={(value) =>
                    setPasswordDraft((prev) => ({
                      ...prev,
                      newPassword: value,
                    }))
                  }
                  placeholder="New password"
                  placeholderTextColor="#94A3B8"
                  className="mt-3 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 text-[14px] text-text"
                  secureTextEntry
                />
                <View className="mt-3 flex-row gap-3">
                  <Pressable
                    onPress={savePassword}
                    disabled={passwordSaving}
                    className="flex-1 rounded-[14px] bg-primary px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-semibold text-background">
                      {passwordSaving ? 'Saving...' : 'Save'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={cancelPasswordEditing}
                    className="flex-1 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 active:opacity-80"
                  >
                    <Text className="text-center text-[14px] font-medium text-text">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <SettingsRow
                title="Change password"
                subtitle="Update the password used for this account."
                onPress={() => {
                  setPasswordStatus(null);
                  setPasswordError(null);
                  setEditingPassword(true);
                }}
                value="Edit"
              />
            )}
            <SettingsRow
              title="Log out"
              subtitle="Ends the current application session on this device."
              onPress={() => logout()}
              value="Exit"
              danger
              last
            />
          </SettingsGroup>
          {passwordError ? <InfoNote>{passwordError}</InfoNote> : null}
          {passwordStatus ? <InfoNote>{passwordStatus}</InfoNote> : null}
        </View>
      </ScrollView>

    </View>
  );
}
