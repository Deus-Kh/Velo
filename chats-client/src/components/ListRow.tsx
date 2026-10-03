import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { useAppearanceStore } from '../store/appearance.store';
import type { LucideIconName } from '../shared/chat/describeMessage';

/**
 * The unified list row (roadmap §8.1 B1; design roadmap §3.5): a flat row
 * of 72 dp (64 dp in Compact) with a 48 dp avatar, the title and a time on
 * the first line, one line of subtitle and a trailing slot (unread badge,
 * action) on the second, and a hairline divider inset to the text column.
 * Used by the chat list, search results, the forward picker and New Chat.
 * Exceptional states (no key, blocked) are a coloured icon and a toned
 * subtitle, never a chip.
 */
export type ListRowTone = 'muted' | 'primary' | 'warning' | 'danger';

export default function ListRow({
  avatar,
  title,
  titleIcon,
  meta,
  subtitle,
  subtitleIcon,
  subtitleTone = 'muted',
  subtitleLines = 1,
  trailing,
  onPress,
  onLongPress,
  disabled,
  divider = true,
  padded = true,
  accessibilityLabel,
  testID,
}: {
  avatar?: ReactNode;
  title: string;
  /** A small primary-coloured mark right after the title (a verified contact). */
  titleIcon?: LucideIconName;
  /** Right of the first line: the time of the last message. */
  meta?: string;
  subtitle?: string;
  /** A small icon in front of the subtitle, in the subtitle's tone. */
  subtitleIcon?: LucideIconName;
  subtitleTone?: ListRowTone;
  subtitleLines?: number;
  /** Right of the second line: an unread badge, a pin mark, an action. */
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  divider?: boolean;
  /** Off inside a sheet that has its own side padding. */
  padded?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const compact = useAppearanceStore((s) => s.interfaceDensity) === 'compact';
  const toneClass =
    subtitleTone === 'warning' ? 'text-warning' : subtitleTone === 'danger' ? 'text-danger' : subtitleTone === 'primary' ? 'text-primary' : 'text-muted';
  const toneColor =
    subtitleTone === 'warning' ? colors.warning : subtitleTone === 'danger' ? colors.danger : subtitleTone === 'primary' ? colors.primary : colors.muted;
  const dividerInset = (padded ? 16 : 0) + (avatar ? 48 + 12 : 0);

  return (
    <View>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled || (!onPress && !onLongPress)}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel ?? title}
        testID={testID}
        className={`flex-row items-center ${padded ? 'px-4' : ''} ${compact ? 'py-2' : 'py-3'} active:bg-background-alt`}
      >
        {avatar ? <View className="mr-3">{avatar}</View> : null}

        <View className="min-w-0 flex-1">
          <View className="flex-row items-center">
            <View className="min-w-0 flex-1 flex-row items-center">
              <Text className="shrink text-[16px] font-semibold leading-[22px] text-text" numberOfLines={1}>
                {title}
              </Text>
              {titleIcon ? (
                <View className="ml-1.5 shrink-0">
                  <Icon lib="Lucide" name={titleIcon} size={16} color={colors.primary} />
                </View>
              ) : null}
            </View>
            {meta ? <Text className="ml-2 shrink-0 text-xs text-muted">{meta}</Text> : null}
          </View>

          <View className="mt-0.5 flex-row items-center">
            {subtitleIcon ? (
              <View className="mr-1.5 shrink-0">
                <Icon lib="Lucide" name={subtitleIcon} size={14} color={toneColor} />
              </View>
            ) : null}
            {subtitle ? (
              <Text className={`flex-1 text-[14px] leading-5 ${toneClass}`} numberOfLines={subtitleLines}>
                {subtitle}
              </Text>
            ) : (
              <View className="flex-1" />
            )}
            {trailing ? <View className="ml-2 shrink-0 flex-row items-center gap-2">{trailing}</View> : null}
          </View>
        </View>
      </Pressable>

      {divider ? <View className="bg-border" style={{ height: StyleSheet.hairlineWidth, marginLeft: dividerInset }} /> : null}
    </View>
  );
}

/** The unread count on a row's second line. */
export function UnreadBadge({ count }: { count: number }) {
  return (
    <View className="h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5">
      <Text className="text-xs font-semibold text-background">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}
