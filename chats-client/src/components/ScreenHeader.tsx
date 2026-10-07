import type { ReactNode } from 'react';
import { Pressable, View, Text } from 'react-native';

import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import type { LucideIconName } from '../shared/chat/describeMessage';

export default function ScreenHeader({
  title,
  subtitle,
  leading,
  actions,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <View className="px-4 pt-2">
      <View className="flex-row items-start justify-between gap-3">
        {leading ? <View className="shrink-0 pt-1">{leading}</View> : null}
        <View className="min-w-0 flex-1">
          <Text className="text-[31px] font-semibold text-text">{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-sm leading-6 text-muted">{subtitle}</Text>
          ) : null}
        </View>
        {actions ? <View className="shrink-0 pt-1">{actions}</View> : null}
      </View>
    </View>
  );
}

/** A round icon button in a screen header's action slot (search, new chat, back). */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: LucideIconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      className="h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-elevated active:opacity-80"
    >
      <Icon lib="Lucide" name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}
