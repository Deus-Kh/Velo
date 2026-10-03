import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_PRIVACY_SETTINGS, userApi, type MeResponse, type PrivacySettings } from '../api/user.api';

export type EditableProfile = Pick<MeResponse, 'username' | 'email'>;
export type EditableProfileField = keyof EditableProfile | null;

/**
 * C1: the account as the server knows it (`/me`): the profile with its
 * inline username / email editor, and the privacy toggles mirrored from
 * the server (T7.4; a failed save reverts). Loaded on mount; the screen
 * reloads it on focus.
 */
export function useOwnAccount(userId: string | null) {
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editingField, setEditingField] = useState<EditableProfileField>(null);
  const [profileDraft, setProfileDraft] = useState<EditableProfile>({
    username: '',
    email: '',
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

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

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const startEditing = useCallback((field: Exclude<EditableProfileField, null>) => {
    setProfileStatus(null);
    setProfileError(null);
    setEditingField(field);
  }, []);

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

  return {
    profile,
    profileLoading,
    loadProfile,
    privacy,
    privacyError,
    handlePrivacyToggle,
    editingField,
    profileDraft,
    setProfileDraft,
    profileError,
    profileStatus,
    profileSaving,
    startEditing,
    cancelProfileEditing,
    saveProfile,
  };
}

export type OwnAccountHandle = ReturnType<typeof useOwnAccount>;
