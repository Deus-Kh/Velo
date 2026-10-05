import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import SectionEyebrow from './SectionEyebrow';
import { Icon } from './Icon';
import type { LucideIconName } from '../shared/chat/describeMessage';

export default function BottomSheetPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <Pressable onPress={onClose} className="absolute inset-0 bg-black/44" />

      <View className="absolute inset-x-3 bottom-24">
        <View className="rounded-[28px] border border-border bg-surface-elevated p-3">
          <SectionEyebrow title={title} compact />
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ paddingBottom: 2 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </>
  );
}

export function BottomSheetAction({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: LucideIconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const textTone = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text';
  const iconColor = tone === 'danger' ? '#F87171' : tone === 'warning' ? '#FBBF24' : '#94A3B8';

  return (
    <Pressable
      onPress={onPress}
      className="min-h-[48px] flex-row items-center rounded-[16px] px-3 active:opacity-80"
    >
      <Icon lib="Lucide" name={icon} size={19} color={iconColor} />
      <Text className={`ml-3 text-[15px] font-medium ${textTone}`}>{label}</Text>
    </Pressable>
  );
}
