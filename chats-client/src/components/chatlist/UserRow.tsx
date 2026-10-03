import { Pressable, Text, View } from 'react-native';

import Avatar from '../Avatar';
import SecurityBadge from './SecurityBadge';
import type { UserListItem } from '../../shared/api/user.api';
import { shortSecureId } from '../../shared/utils/identity';
import type { StoredProfile } from '../../shared/storage/profileStore';
import { useAppearanceStore } from '../../store/appearance.store';

/** A directory contact in the search results, with no conversation yet. */
export default function UserRow({ user, profile, onPress }: { user: UserListItem; profile: StoredProfile | null; onPress: () => void }) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
        surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
      } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
    >
      <View className="flex-row items-center">
        <Avatar name={user.username || '?'} profile={profile} size={interfaceDensity === 'compact' ? 'md' : 'lg'} className="mr-4" />

        <View className="flex-1">
          <Text className="text-base font-semibold text-text">{user.username}</Text>
          <Text className="mt-1 text-sm text-muted">{shortSecureId(user.userId)}</Text>
          <View
            className={`flex-row items-center justify-between ${
              interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
            }`}
          >
            <SecurityBadge
              ready={Boolean(user.hasPublicKey)}
              label={user.hasPublicKey ? 'Ready for E2EE' : 'No public key yet'}
            />
            <Text className="text-xs font-medium text-muted">Start chat</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
