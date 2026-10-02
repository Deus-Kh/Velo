import { useCallback, useEffect, useMemo, useState } from 'react';
import { validatePassword } from '../shared/validation/password';
import { Alert, ScrollView, View, Text, Pressable, TextInput, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { sessionMasterKeyService } from '../shared/crypto/sessionMasterKey';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import ScreenHeader from '../components/ScreenHeader';
import SectionEyebrow from '../components/SectionEyebrow';
import StatusChip from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { useAuthStore } from '../store/auth.store';
import { wipeLocalStateForUser } from '../shared/storage/localWipe';
import { saveStoredSession } from '../shared/auth/tokenStore';
import { setAccessToken } from '../shared/auth/session';
import { authApi } from '../shared/api/auth.api';
import { DEFAULT_PRIVACY_SETTINGS, userApi, type MeResponse, type PrivacySettings } from '../shared/api/user.api';
import BlockedContactsSheet from '../components/BlockedContactsSheet';
import DeleteAccountSheet from '../components/DeleteAccountSheet';
import ProfileSheet from '../components/ProfileSheet';
import Avatar from '../components/Avatar';
import { useProfilesStore } from '../store/profiles.store';
import { updateOwnProfile } from '../shared/chat/profile';
import { useBlocksStore } from '../store/blocks.store';
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
  /** The per-user session master key that seals sessions, secrets and the local message store (T1.3, T2.14). */
  sessionMasterKeyReady: boolean;
  sessionCount: number;
  trustedContactsCount: number;
  storedMessagesCount: number;
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
  const colors = useThemeColors();

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

        {trailing ? trailing : onPress ? <Icon lib="Lucide" name="chevron-right" size={18} color={colors.muted} /> : null}
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
        <Avatar name={profile?.username ?? userId ?? 'U'} profile={useProfilesStore.getState().own} size="lg" />
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
  /** T7.4: privacy toggles, mirrored from the server; a failed save reverts. */
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const ownProfile = useProfilesStore((s) => s.own);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [profileSheetBusy, setProfileSheetBusy] = useState(false);
  const [profileSheetError, setProfileSheetError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const blockedCount = useBlocksStore((s) => (userId ? s.blockedByUser[String(userId)] : undefined)?.length ?? 0);
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
        sessionMasterKeyCreds,
      ] = await Promise.all([
        Keychain.getGenericPassword({ service: `identity-sign:${userId}` }),
        Keychain.getGenericPassword({ service: `identity-dh:${userId}` }),
        Keychain.getGenericPassword({ service: `signed-prekey:${userId}` }),
        Keychain.getGenericPassword({ service: sessionMasterKeyService(userId) }),
      ]);

      setDiagnostics({
        identityKeyReady: Boolean(identityKeyCreds),
        identityDhReady: Boolean(identityDhCreds),
        signedPreKeyReady: Boolean(signedPreKeyCreds),
        sessionMasterKeyReady: Boolean(sessionMasterKeyCreds),
        sessionCount: allKeys.filter((key) => key.startsWith(`session:v2:${userId}:`)).length,
        trustedContactsCount: allKeys.filter((key) => key.startsWith(`trusted-identity:${userId}:`)).length,
        storedMessagesCount: allKeys.filter((key) => key.startsWith(`msg:v1:${userId}:`)).length,
        oneTimePreKeysCount: allKeys.filter((key) => key.startsWith(`otpk:${userId}:`)).length,
      });
    } catch (error) {
      console.warn('[Settings] Failed to load secure diagnostics:', error);
      setDiagnostics(null);
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [userId]);

  const handlePrivacyToggle = useCallback(
    async (key: keyof PrivacySettings, value: boolean) => {
      const previous = privacy;
      setPrivacy({ ...previous, [key]: value });
      setPrivacyError(null);
      try {
        const res = await userApi.updatePrivacy({ [key]: value });
        setPrivacy(res.data);
      } catch (error: any) {
        setPrivacy(previous);
        setPrivacyError(error?.response?.data?.error || error?.message || 'Could not save the setting');
      }
    },
    [privacy],
  );

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
      if (res.data.privacy) setPrivacy(res.data.privacy);
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

  const confirmResetLocalSecurityState = () => {
    Alert.alert(
      'Reset encryption on this phone?',
      'This removes your keys and secure sessions from this phone. ' +
        'Contacts will see that your safety number changed, and each chat starts a fresh secure session. ' +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => { resetLocalSecurityState(); } },
      ],
    );
  };

  const confirmLogout = () => {
    Alert.alert(
      'Log out?',
      'Keep local data to sign back in with your sessions intact, or erase it so nothing on this device can decrypt your messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', onPress: () => { logout(); } },
        {
          text: 'Log out and erase local data',
          style: 'destructive',
          onPress: () => { logout({ eraseLocalData: true }); },
        },
      ],
    );
  };

  const resetLocalSecurityState = async () => {
    if (!userId || isResettingSecurity) return;

    setIsResettingSecurity(true);
    setSecurityResetStatus(null);

    try {
      const report = await wipeLocalStateForUser(userId, 'all');
      if (report.failures.length) {
        console.warn('[Settings] partial wipe:', report.failures.join('; '));
      }

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
    : diagnostics?.sessionMasterKeyReady
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
    const rule = validatePassword(passwordDraft.newPassword);
    if (rule !== true) {
      setPasswordError(rule);
      return;
    }

    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordStatus(null);

    try {
      const res = await authApi.changePassword({
        currentPassword: passwordDraft.currentPassword,
        newPassword: passwordDraft.newPassword,
      });
      // The server revoked every refresh family (including ours) and handed
      // this client a fresh pair; adopt it or the next refresh logs us out.
      if (res.data.refreshToken && res.data.accessToken && userId) {
        await saveStoredSession({ userId, refreshToken: res.data.refreshToken });
        setAccessToken(res.data.accessToken);
      }
      setPasswordStatus('Password updated for this account. Other devices were signed out.');
      setPasswordDraft({
        currentPassword: '',
        newPassword: '',
      });
      setEditingPassword(false);
    } catch (error: any) {
      setPasswordError(
        error?.response?.data?.fields?.newPassword ||
          error?.response?.data?.fields?.currentPassword ||
          error?.response?.data?.error ||
          error?.message ||
          'Failed to change password',
      );
    } finally {
      setPasswordSaving(false);
    }
  }, [passwordDraft.currentPassword, passwordDraft.newPassword, userId]);

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
            title="Shared profile"
            description="What contacts see for you. It travels over your encrypted sessions; the server stores none of it."
          />
          <SettingsGroup>
            <SettingsRow
              title="Name and avatar"
              subtitle={ownProfile ? `${ownProfile.name}${ownProfile.avatar ? ' · avatar set' : ' · no avatar'}` : 'Not set: contacts see your username.'}
              onPress={() => {
                setProfileSheetError(null);
                setShowProfileSheet(true);
              }}
              trailing={<Avatar name={ownProfile?.name || profile?.username || 'U'} profile={ownProfile} size="sm" />}
              last
            />
          </SettingsGroup>

          <SectionEyebrow
            title="Privacy"
            description="Controls and explanations related to identity trust and secure communication."
          />
          <SettingsGroup>
            <SettingsRow
              title="Show when I'm online"
              subtitle="Off by default: contacts never see a live presence unless you allow it."
              onPress={() => handlePrivacyToggle('online', !privacy.online)}
              trailing={<SettingsToggle value={privacy.online} onValueChange={(v) => handlePrivacyToggle('online', v)} />}
            />
            <SettingsRow
              title="Show last seen"
              subtitle="Off by default: contacts see nothing about when you were last here."
              onPress={() => handlePrivacyToggle('lastSeen', !privacy.lastSeen)}
              trailing={<SettingsToggle value={privacy.lastSeen} onValueChange={(v) => handlePrivacyToggle('lastSeen', v)} />}
            />
            <SettingsRow
              title="Send read receipts"
              subtitle="Tell senders when you have read their messages. Your own unread counts are unaffected."
              onPress={() => handlePrivacyToggle('readReceipts', !privacy.readReceipts)}
              trailing={<SettingsToggle value={privacy.readReceipts} onValueChange={(v) => handlePrivacyToggle('readReceipts', v)} />}
            />
            <SettingsRow
              title="Show typing"
              subtitle="Let the other side see when you are typing."
              onPress={() => handlePrivacyToggle('typing', !privacy.typing)}
              trailing={<SettingsToggle value={privacy.typing} onValueChange={(v) => handlePrivacyToggle('typing', v)} />}
              last={!privacyError}
            />
            {privacyError ? (
              <View className="px-4 pb-3">
                <Text className="text-xs text-danger">{privacyError}</Text>
              </View>
            ) : null}
          </SettingsGroup>
          <SettingsGroup>
            <SettingsRow
              title="Blocked contacts"
              subtitle="They cannot message you, see your presence or typing, or reach you in groups."
              value={String(blockedCount)}
              onPress={() => setShowBlocked(true)}
            />
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
            description="Keys and secure sessions kept on this phone."
          />
          <SettingsGroup>
            <SettingsRow
              title="Your keys"
              subtitle="The keys that identify this account to your contacts."
              trailing={
                <StatusChip
                  label={keyStateValue}
                  tone={keyStateValue === 'Ready' ? 'success' : 'warning'}
                />
              }
            />
            <SettingsRow
              title="Message protection"
              subtitle="Messages and keys on this phone are stored encrypted."
              trailing={
                <StatusChip
                  label={encryptionValue}
                  tone={encryptionValue === 'Enabled' ? 'success' : 'warning'}
                />
              }
            />
            <SettingsRow
              title="Secure sessions"
              subtitle="Encrypted sessions with your contacts, kept on this phone."
              value={diagnosticsLoading ? 'Checking' : `${diagnostics?.sessionCount ?? 0}`}
            />
            <SettingsRow
              title="Stored messages"
              subtitle="Messages kept on this phone, each stored encrypted."
              value={diagnosticsLoading ? 'Checking' : `${diagnostics?.storedMessagesCount ?? 0}`}
            />
            <SettingsRow
              title="Keys for new chats"
              subtitle="Spare keys that let a contact start a secure chat with you while you are offline."
              value={
                diagnosticsLoading
                  ? 'Checking'
                  : diagnostics?.signedPreKeyReady
                    ? `${diagnostics?.oneTimePreKeysCount ?? 0} ready`
                    : 'Missing'
              }
              last
            />
          </SettingsGroup>

          <SectionEyebrow
            title="This phone"
            description="Your session on this phone and how to recover it."
          />
          <SettingsGroup>
            <SettingsRow
              title="Current device"
              subtitle="Signed in on this phone. Secure chats resume on their own after a reconnect."
              trailing={<StatusChip label="Connected" tone="success" />}
            />
            <SettingsRow
              title="Check again"
              subtitle="Re-check the keys and sessions on this phone."
              onPress={loadDiagnostics}
              value={diagnosticsLoading ? 'Refreshing' : 'Refresh'}
            />
            <SettingsRow
              title="Reset encryption on this phone"
              subtitle="Removes this account's secure sessions, trusted contacts and keys from this phone. Chats start fresh secure sessions afterwards."
              onPress={confirmResetLocalSecurityState}
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
              onPress={confirmLogout}
              value="Exit"
              danger
            />
            <SettingsRow
              title="Delete account"
              subtitle="Removes everything the server holds for you and erases this device. Cannot be undone."
              onPress={() => {
                setDeleteError(null);
                setShowDeleteAccount(true);
              }}
              value="Delete"
              danger
              last
            />
          </SettingsGroup>
          {passwordError ? <InfoNote>{passwordError}</InfoNote> : null}
          {passwordStatus ? <InfoNote>{passwordStatus}</InfoNote> : null}
        </View>
      </ScrollView>

      {showBlocked && userId ? <BlockedContactsSheet myUserId={String(userId)} onClose={() => setShowBlocked(false)} /> : null}
      {showProfileSheet && userId ? (
        <ProfileSheet
          current={ownProfile}
          fallbackName={profile?.username || ''}
          busy={profileSheetBusy}
          error={profileSheetError}
          onClose={() => setShowProfileSheet(false)}
          onSave={(name, avatar) => {
            setProfileSheetBusy(true);
            setProfileSheetError(null);
            updateOwnProfile(String(userId), { name, avatar })
              .then(() => setShowProfileSheet(false))
              .catch((e: any) => setProfileSheetError(e?.message || 'Could not save the profile'))
              .finally(() => setProfileSheetBusy(false));
          }}
        />
      ) : null}
      {showDeleteAccount ? (
        <DeleteAccountSheet
          busy={deleteBusy}
          error={deleteError}
          onClose={() => setShowDeleteAccount(false)}
          onConfirm={(password) => {
            setDeleteBusy(true);
            setDeleteError(null);
            deleteAccount(password)
              .then(() => setShowDeleteAccount(false))
              .catch((e: any) => setDeleteError(e?.response?.status === 401 ? 'Password is incorrect.' : e?.response?.data?.error || e?.message || 'Could not delete the account'))
              .finally(() => setDeleteBusy(false));
          }}
        />
      ) : null}
    </View>
  );
}
