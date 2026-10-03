import { Text, TextInput, View } from 'react-native';

import SectionEyebrow from '../SectionEyebrow';
import { InfoNote, InlineEditorButtons, SettingsGroup, SettingsRow, maskUserId } from './primitives';
import type { OwnAccountHandle } from '../../shared/settings/useOwnAccount';

/** Settings → Profile: username and email with inline editors, and the account id. */
export default function ProfileSection({ account, userId }: { account: OwnAccountHandle; userId: string | null }) {
  const { profile, profileLoading, editingField, profileDraft, setProfileDraft, profileError, profileStatus, profileSaving, startEditing, cancelProfileEditing, saveProfile } = account;

  return (
    <>
      <SectionEyebrow title="Profile" />
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
            <InlineEditorButtons saving={profileSaving} onSave={saveProfile} onCancel={cancelProfileEditing} />
          </View>
        ) : (
          <SettingsRow
            title="Display name"
            subtitle={profileLoading ? 'Loading profile...' : profile?.username || 'Not available'}
            onPress={() => startEditing('username')}
            value="Edit"
            chevron={false}
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
            <InlineEditorButtons saving={profileSaving} onSave={saveProfile} onCancel={cancelProfileEditing} />
          </View>
        ) : (
          <SettingsRow
            title="Email"
            subtitle={profileLoading ? 'Loading email...' : profile?.email || 'Not available'}
            onPress={() => startEditing('email')}
            value="Edit"
            chevron={false}
          />
        )}
        <SettingsRow
          title="Account ID"
          subtitle={userId ? maskUserId(userId) : 'Signed in on this device'}
          last
        />
      </SettingsGroup>
      {profileError ? <InfoNote>{profileError}</InfoNote> : null}
      {profileStatus ? <InfoNote>{profileStatus}</InfoNote> : null}
    </>
  );
}
