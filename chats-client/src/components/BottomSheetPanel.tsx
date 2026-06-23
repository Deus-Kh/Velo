import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import SectionEyebrow from './SectionEyebrow';

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
          {children}
        </View>
      </View>
    </>
  );
}
