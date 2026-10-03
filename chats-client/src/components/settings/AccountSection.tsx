import { useCallback, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import SectionEyebrow from '../SectionEyebrow';
import { InfoNote, InlineEditorButtons, SettingsGroup, SettingsRow } from './primitives';
import { authApi } from '../../shared/api/auth.api';
import { saveStoredSession } from '../../shared/auth/tokenStore';
import { setAccessToken } from '../../shared/auth/session';
import { validatePassword } from '../../shared/validation/password';
import { useAuthStore } from '../../store/auth.store';

type PasswordDraft = {
  currentPassword: string;
  newPassword: string;
};

/** Settings → Account: change password inline, log out (confirmed), delete account (sheet owned by the screen). */
export default function AccountSection({ userId, onOpenDeleteAccount }: { userId: string | null; onOpenDeleteAccount: () => void }) {
  const logout = useAuthStore((s) => s.logout);
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    currentPassword: '',
    newPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

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

  return (
    <>
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
            <InlineEditorButtons saving={passwordSaving} onSave={savePassword} onCancel={cancelPasswordEditing} />
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
          onPress={onOpenDeleteAccount}
          value="Delete"
          danger
          last
        />
      </SettingsGroup>
      {passwordError ? <InfoNote>{passwordError}</InfoNote> : null}
      {passwordStatus ? <InfoNote>{passwordStatus}</InfoNote> : null}
    </>
  );
}
