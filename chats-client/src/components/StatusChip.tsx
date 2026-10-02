import { View, Text } from 'react-native';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import type { LucideIconName } from '../shared/chat/describeMessage';

type StatusChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export default function StatusChip({
  label,
  tone = 'neutral',
  size = 'sm',
  icon,
}: {
  label: string;
  tone?: StatusChipTone;
  size?: 'sm' | 'xs';
  /** A Lucide icon in front of the label (never an emoji in the label). */
  icon?: LucideIconName;
}) {
  const colors = useThemeColors();
  const iconColor =
    tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.text;
  const toneClasses =
    tone === 'primary'
      ? 'border-primary/30 bg-primary/12'
      : tone === 'success'
        ? 'border-success/30 bg-success/12'
        : tone === 'warning'
          ? 'border-warning/30 bg-warning/12'
          : tone === 'danger'
            ? 'border-danger/30 bg-danger/12'
            : 'border-border bg-background-alt/70';

  const textTone =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'success'
        ? 'text-success'
        : tone === 'warning'
          ? 'text-warning'
          : tone === 'danger'
            ? 'text-danger'
            : 'text-text';

  return (
    <View
      className={`flex-row items-center self-start rounded-full border ${toneClasses} ${
        size === 'xs' ? 'px-2 py-0.5' : 'px-2.5 py-1'
      }`}
    >
      {icon ? (
        <View className="mr-1">
          <Icon lib="Lucide" name={icon} size={size === 'xs' ? 11 : 12} color={iconColor} />
        </View>
      ) : null}
      <Text
        className={`${size === 'xs' ? 'text-[10px]' : 'text-[11px]'} font-semibold ${textTone}`}
      >
        {label}
      </Text>
    </View>
  );
}
