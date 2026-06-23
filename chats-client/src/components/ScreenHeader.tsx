import type { ReactNode } from 'react';
import { View, Text } from 'react-native';

export default function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <View className="px-4 pt-2">
      <View className="flex-row items-start justify-between gap-3">
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
