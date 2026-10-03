import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../Icon';
import { useThemeColors } from '../../theme/useThemeColors';
import { useAppearanceStore } from '../../store/appearance.store';

/**
 * C1: the card at the top of a conversation: back, an avatar, the title
 * with its subtitle and status chips, and the screen's own actions on the
 * right. Shared by the 1:1 chat and the group chat.
 */
export default function ChatHeader({
  onClose,
  avatar,
  title,
  titleNumberOfLines,
  subtitle,
  children,
  actions,
}: {
  onClose: () => void;
  avatar: ReactNode;
  title: string;
  titleNumberOfLines?: number;
  subtitle: string;
  /** Status chips under the subtitle. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <View className="px-4" style={{ paddingTop: insets.top + 6 }}>
      <View
        className={`rounded-[22px] border border-border px-4 ${
          interfaceDensity === 'compact' ? 'py-2.5' : 'py-3'
        } ${surfaceStyle === 'glass' ? 'bg-surface/88' : 'bg-surface-elevated'}`}
      >
        <View className="flex-row items-center">
          <Pressable
            onPress={onClose}
            className={`mr-3 items-center justify-center rounded-full border border-border active:opacity-80 ${
              interfaceDensity === 'compact' ? 'h-9 w-9' : 'h-10 w-10'
            } ${surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'}`}
          >
            <Icon lib="Lucide" name="chevron-left" size={22} color={colors.text} />
          </Pressable>

          {avatar}

          <View className="flex-1 pr-2">
            <Text className="text-[20px] font-semibold text-text" numberOfLines={titleNumberOfLines}>
              {title}
            </Text>
            <Text className="mt-1 text-sm leading-5 text-muted">{subtitle}</Text>
            {children}
          </View>

          {actions}
        </View>
      </View>
    </View>
  );
}

/** A pill button in the header's action slot. */
export function HeaderAction({
  onPress,
  className = '',
  horizontalPadding = 'px-4',
  children,
}: {
  onPress: () => void;
  className?: string;
  horizontalPadding?: string;
  children: ReactNode;
}) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <Pressable
      onPress={onPress}
      className={`${className} rounded-full border border-border ${horizontalPadding} ${
        interfaceDensity === 'compact' ? 'py-1.5' : 'py-2'
      } active:opacity-80 ${surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'}`}
    >
      {children}
    </Pressable>
  );
}
