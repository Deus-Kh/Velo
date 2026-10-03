import { Image, Text, View } from 'react-native';
import type { StoredProfile } from '../shared/storage/profileStore';

/**
 * T7.7: a user's avatar: the shared profile's JPEG or emoji-on-colour,
 * else the first letter of the name on the soft primary tone.
 */
const SIZES = {
  sm: { box: 'h-9 w-9', text: 'text-sm', emoji: 'text-[18px]', px: 36 },
  md: { box: 'h-11 w-11', text: 'text-base', emoji: 'text-[22px]', px: 44 },
  /** B1: the list-row size (chat list, contacts, pickers). */
  list: { box: 'h-12 w-12', text: 'text-base', emoji: 'text-[24px]', px: 48 },
  lg: { box: 'h-14 w-14', text: 'text-lg', emoji: 'text-[28px]', px: 56 },
  xl: { box: 'h-20 w-20', text: 'text-2xl', emoji: 'text-[40px]', px: 80 },
} as const;

export default function Avatar({ name, profile, size = 'md', className = '' }: { name: string; profile?: StoredProfile | null; size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  const avatar = profile?.avatar ?? null;
  if (avatar?.kind === 'jpeg') {
    return <Image source={{ uri: 'data:image/jpeg;base64,' + avatar.data }} className={`${s.box} rounded-full ${className}`} style={{ width: s.px, height: s.px, borderRadius: s.px / 2 }} accessibilityLabel={name} />;
  }
  if (avatar?.kind === 'emoji') {
    return (
      <View className={`${s.box} items-center justify-center rounded-full ${className}`} style={{ backgroundColor: avatar.color }} accessibilityLabel={name}>
        <Text className={s.emoji}>{avatar.emoji}</Text>
      </View>
    );
  }
  const initial = (profile?.name || name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <View className={`${s.box} items-center justify-center rounded-full bg-primary-soft ${className}`} accessibilityLabel={name}>
      <Text className={`${s.text} font-semibold text-primary`}>{initial}</Text>
    </View>
  );
}
