import { Text, View } from 'react-native';

import BottomSheetPanel from '../BottomSheetPanel';
import { Icon } from '../Icon';
import { useThemeColors } from '../../theme/useThemeColors';
import type { LucideIconName } from '../../shared/chat/describeMessage';

const STEPS: { icon: LucideIconName; text: string }[] = [
  { icon: 'hash', text: 'Every chat has a safety number, made from your keys and your contact’s keys. It is the same on both phones.' },
  { icon: 'users', text: 'Open the chat, tap Verify, and compare the number with your contact in person or on a call. If it matches, nobody sits between you.' },
  { icon: 'badge-check', text: 'Mark the contact as verified. If their keys ever change, the chat warns you before you send anything.' },
  { icon: 'smartphone', text: 'Verification stays on this phone. The server never learns whom you verified.' },
];

/** B4: a short explainer in place of the static "Verification flow" / "Security explanations" rows. */
export default function VerificationExplainerSheet({ onClose }: { onClose: () => void }) {
  const colors = useThemeColors();
  return (
    <BottomSheetPanel title="How verification works" onClose={onClose}>
      <View className="px-1 pb-1">
        {STEPS.map((step) => (
          <View key={step.icon} className="mt-2 flex-row items-start">
            <View className="mr-3 mt-0.5 h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Icon lib="Lucide" name={step.icon} size={16} color={colors.primary} />
            </View>
            <Text className="min-w-0 flex-1 text-[14px] leading-5 text-text">{step.text}</Text>
          </View>
        ))}
      </View>
    </BottomSheetPanel>
  );
}
