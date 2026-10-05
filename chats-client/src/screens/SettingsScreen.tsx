import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import ScreenHeader from '../components/ScreenHeader';
import { HeaderIconButton } from '../components/ScreenHeader';
import { useAuthStore } from '../store/auth.store';
import BlockedContactsSheet from '../components/BlockedContactsSheet';
import DeleteAccountSheet from '../components/DeleteAccountSheet';
import ProfileSheet from '../components/ProfileSheet';
import { useProfilesStore } from '../store/profiles.store';
import { updateOwnProfile } from '../shared/chat/profile';
import AccountHero from '../components/settings/AccountHero';
import AccountSection from '../components/settings/AccountSection';
import AppearanceSection from '../components/settings/AppearanceSection';
import EncryptionSection from '../components/settings/EncryptionSection';
import NotificationsSection from '../components/settings/NotificationsSection';
import PrivacySection from '../components/settings/PrivacySection';
import ProfileSection from '../components/settings/ProfileSection';
import SharedProfileSection from '../components/settings/SharedProfileSection';
import ThisPhoneSection from '../components/settings/ThisPhoneSection';
import TrustedContactsSheet from '../components/settings/TrustedContactsSheet';
import VerificationExplainerSheet from '../components/settings/VerificationExplainerSheet';
import { useOwnAccount } from '../shared/settings/useOwnAccount';
import { useSecurityDiagnostics } from '../shared/settings/useSecurityDiagnostics';
import { SettingsGroup, SettingsRow } from '../components/settings/primitives';

type SettingsPage = 'main' | 'profile' | 'privacy' | 'notifications' | 'appearance' | 'account' | 'advanced';

const PAGE_TITLES: Record<Exclude<SettingsPage, 'main'>, string> = {
  profile: 'Profile',
  privacy: 'Privacy',
  notifications: 'Notifications',
  appearance: 'Appearance',
  account: 'Account',
  advanced: 'Advanced',
};

/**
 * Settings. Each section is a component under `components/settings`; the
 * account (`/me`, privacy) and the key diagnostics are hooks under
 * `shared/settings` because several sections read them. The sheets stay
 * here, outside the scroll view, because they are absolute overlays (C1).
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const ownProfile = useProfilesStore((s) => s.own);

  const { diagnostics, diagnosticsLoading, loadDiagnostics, keyStateValue, encryptionValue } = useSecurityDiagnostics(userId);
  const account = useOwnAccount(userId);
  const { profile, loadProfile, privacy, privacyError, handlePrivacyToggle } = account;

  const [showBlocked, setShowBlocked] = useState(false);
  const [showTrusted, setShowTrusted] = useState(false);
  const [showVerificationHelp, setShowVerificationHelp] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [profileSheetBusy, setProfileSheetBusy] = useState(false);
  const [profileSheetError, setProfileSheetError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [page, setPage] = useState<SettingsPage>('main');

  useFocusEffect(
    useCallback(() => {
      loadDiagnostics();
      loadProfile();
    }, [loadDiagnostics, loadProfile]),
  );

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
            title={page === 'main' ? 'Settings' : PAGE_TITLES[page]}
            leading={
              page !== 'main' ? (
                <HeaderIconButton icon="chevron-left" label="Back to Settings" onPress={() => setPage('main')} />
              ) : undefined
            }
          />

          {page === 'main' ? (
            <>
              <AccountHero
                profile={profile}
                userId={userId}
                keyStateValue={keyStateValue}
                encryptionValue={encryptionValue}
              />
              <SettingsGroup>
                <SettingsRow title="Profile" subtitle="Name, email and account identity." onPress={() => setPage('profile')} />
                <SettingsRow title="Privacy" subtitle="Presence, receipts, blocked and trusted contacts." onPress={() => setPage('privacy')} />
                <SettingsRow title="Notifications" subtitle="Push notifications and in-app alerts." onPress={() => setPage('notifications')} />
                <SettingsRow title="Appearance" subtitle="Theme, density and surface style." onPress={() => setPage('appearance')} />
                <SettingsRow title="Account" subtitle="Password, logout and account deletion." onPress={() => setPage('account')} />
                <SettingsRow title="Advanced" subtitle="Encryption diagnostics and this phone." onPress={() => setPage('advanced')} last />
              </SettingsGroup>
            </>
          ) : null}

          {page === 'profile' ? (
            <>
              <ProfileSection account={account} userId={userId} />
              <SharedProfileSection
                fallbackName={profile?.username}
                onOpen={() => {
                  setProfileSheetError(null);
                  setShowProfileSheet(true);
                }}
              />
            </>
          ) : null}

          {page === 'privacy' ? (
            <PrivacySection
              userId={userId}
              privacy={privacy}
              privacyError={privacyError}
              onToggle={handlePrivacyToggle}
              diagnostics={diagnostics}
              diagnosticsLoading={diagnosticsLoading}
              onOpenBlocked={() => setShowBlocked(true)}
              onOpenTrusted={() => setShowTrusted(true)}
              onOpenVerificationHelp={() => setShowVerificationHelp(true)}
            />
          ) : null}

          {page === 'notifications' ? <NotificationsSection userId={userId} /> : null}
          {page === 'appearance' ? <AppearanceSection /> : null}
          {page === 'account' ? (
            <AccountSection
              userId={userId}
              onOpenDeleteAccount={() => {
                setDeleteError(null);
                setShowDeleteAccount(true);
              }}
            />
          ) : null}
          {page === 'advanced' ? (
            <>
              <EncryptionSection
                diagnostics={diagnostics}
                diagnosticsLoading={diagnosticsLoading}
                keyStateValue={keyStateValue}
                encryptionValue={encryptionValue}
              />
              <ThisPhoneSection userId={userId} diagnosticsLoading={diagnosticsLoading} loadDiagnostics={loadDiagnostics} />
            </>
          ) : null}
        </View>
      </ScrollView>

      {showBlocked && userId ? <BlockedContactsSheet myUserId={String(userId)} onClose={() => setShowBlocked(false)} /> : null}
      {showTrusted && userId ? <TrustedContactsSheet myUserId={String(userId)} onClose={() => setShowTrusted(false)} /> : null}
      {showVerificationHelp ? <VerificationExplainerSheet onClose={() => setShowVerificationHelp(false)} /> : null}
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
