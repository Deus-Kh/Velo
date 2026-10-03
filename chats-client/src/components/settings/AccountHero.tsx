import { Text, View } from 'react-native';

import Avatar from '../Avatar';
import StatusChip from '../StatusChip';
import { maskUserId } from './primitives';
import type { MeResponse } from '../../shared/api/user.api';
import { useProfilesStore } from '../../store/profiles.store';

/** The card at the top of Settings: who is signed in, with the key and protection state. */
export default function AccountHero({
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
