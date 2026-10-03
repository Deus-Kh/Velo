import { Pressable, Text, View } from 'react-native';

import { Icon } from '../Icon';
import QuoteLine from '../QuoteLine';
import { useThemeColors } from '../../theme/useThemeColors';
import { useAppearanceStore } from '../../store/appearance.store';
import type { DescribableMessage } from '../../shared/chat/describeMessage';

/** "Editing message" above the composer, with one line of the message being edited. */
export default function EditBar({ message, onCancel }: { message: DescribableMessage; onCancel: () => void }) {
  const colors = useThemeColors();
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <View
      className={`mb-2.5 rounded-[20px] border border-border px-4 py-3 ${
        surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
      }`}
    >
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 h-8 w-1 rounded-full bg-warning" />
        <View className="flex-1">
          <Text className="text-[12px] font-semibold uppercase tracking-[1px] text-warning">Editing message</Text>
          <QuoteLine message={message} className="mt-1" />
        </View>
        <Pressable
          onPress={onCancel}
          className="h-8 w-8 items-center justify-center rounded-full bg-background-alt/60 active:opacity-80"
        >
          <Icon lib="Lucide" name="x" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}
