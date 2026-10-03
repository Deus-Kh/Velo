import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '@react-native-community/hooks';

import { useAppearanceStore } from '../../store/appearance.store';

/**
 * C1: the strip at the bottom of a conversation that holds the composer.
 * Its bottom padding follows the keyboard and the system navigation bar.
 */
export default function ComposerFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const { keyboardShown, keyboardHeight } = useKeyboard();
  const hasNavigationButtons = insets.bottom >= 40;

  return (
    <View
      className={`px-3 ${interfaceDensity === 'compact' ? 'pt-1.5' : 'pt-2'}`}
      style={{ paddingBottom: keyboardShown ? (hasNavigationButtons ? keyboardHeight + insets.bottom + 5 : insets.bottom + 5) : insets.bottom + 8 }}
    >
      {children}
    </View>
  );
}
