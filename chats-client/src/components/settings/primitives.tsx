import type { ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useThemeColors } from '../../theme/useThemeColors';

import { Icon } from '../Icon';
import type { ThemePreference } from '../../store/appearance.store';

/** C1: the building blocks of the Settings screen: a group card, a row, a note, selectors, a toggle. */

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <View className="mt-3 overflow-hidden rounded-[22px] border border-border bg-surface/92">
      {children}
    </View>
  );
}

export function SettingsRow({
  title,
  subtitle,
  value,
  danger,
  onPress,
  trailing,
  last,
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void | Promise<void>;
  trailing?: ReactNode;
  last?: boolean;
  /** B4: a chevron only where the row opens something; off for inline editors, confirmations and reloads. */
  chevron?: boolean;
}) {
  const textTone = danger ? 'text-danger' : 'text-text';
  const colors = useThemeColors();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className={`${last ? '' : 'border-b border-border'} px-4 py-3.5 ${onPress ? 'active:opacity-80' : ''}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className={`text-[15px] font-medium ${textTone}`}>{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</Text>
          ) : null}
        </View>

        {value ? (
          <Text className={`text-[13px] ${danger ? 'text-danger' : 'text-muted'}`}>{value}</Text>
        ) : null}

        {trailing ? trailing : onPress && chevron ? <Icon lib="Lucide" name="chevron-right" size={18} color={colors.muted} /> : null}
      </View>
    </Pressable>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <View className="mt-3 rounded-[18px] border border-border bg-background-alt/70 px-4 py-3">
      <Text className="text-[13px] leading-6 text-muted">{children}</Text>
    </View>
  );
}

export function ThemeModeSelector({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const options: { key: ThemePreference; label: string }[] = [
    { key: 'system', label: 'System' },
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
  ];

  return (
    <View className="mt-3 flex-row rounded-[18px] border border-border bg-background-alt/70 p-1">
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            className={`flex-1 items-center rounded-[14px] px-3 py-2.5 active:opacity-80 ${
              active ? 'bg-surface-elevated' : ''
            }`}
          >
            <Text className={`text-[13px] font-medium ${active ? 'text-text' : 'text-muted'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SegmentedSelector<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <View className="mt-3 flex-row rounded-[18px] border border-border bg-background-alt/70 p-1">
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            className={`flex-1 items-center rounded-[14px] px-3 py-2.5 active:opacity-80 ${
              active ? 'bg-surface-elevated' : ''
            }`}
          >
            <Text className={`text-[13px] font-medium ${active ? 'text-text' : 'text-muted'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsToggle({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.toggleTrackOff, true: colors.toggleTrackOn }}
      thumbColor={value ? colors.toggleThumbOn : colors.toggleThumbOff}
      ios_backgroundColor={colors.toggleTrackOff}
    />
  );
}

export function maskUserId(userId: string | null): string {
  if (!userId) return 'Local session';
  if (userId.length <= 10) return userId;
  return `${userId.slice(0, 6)}...${userId.slice(-4)}`;
}

/** The inline Save / Cancel pair under an editable field. */
export function InlineEditorButtons({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <View className="mt-3 flex-row gap-3">
      <Pressable
        onPress={onSave}
        disabled={saving}
        className="flex-1 rounded-[14px] bg-primary px-3 py-3 active:opacity-80"
      >
        <Text className="text-center text-[14px] font-semibold text-background">
          {saving ? 'Saving...' : 'Save'}
        </Text>
      </Pressable>
      <Pressable
        onPress={onCancel}
        className="flex-1 rounded-[14px] border border-border bg-surface-elevated px-3 py-3 active:opacity-80"
      >
        <Text className="text-center text-[14px] font-medium text-text">Cancel</Text>
      </Pressable>
    </View>
  );
}
