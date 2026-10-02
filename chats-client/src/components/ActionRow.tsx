import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Lucide } from '@react-native-vector-icons/lucide/static';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';

type LucideName = ComponentProps<typeof Lucide>['name'];

/**
 * A list row that performs an action rather than opening a contact
 * (Telegram's "New Group" / "New Contact" rows): a tinted round icon, a
 * title, an optional one-line subtitle and a chevron. Its height comes from
 * its content, so it renders the same inside a column or a list (roadmap
 * §8.1 A6: the previous card collapsed to an empty outline in a column).
 */
export default function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  testID,
  className = '',
}: {
  icon: LucideName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  className?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      testID={testID}
      className={`flex-row items-center rounded-[18px] border border-border bg-surface/88 px-4 py-3 active:opacity-80 ${className}`}
    >
      <View className="mr-3.5 h-10 w-10 items-center justify-center rounded-full bg-primary/15">
        <Icon lib="Lucide" name={icon} size={20} color={colors.primary} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold text-text" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Icon lib="Lucide" name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}
