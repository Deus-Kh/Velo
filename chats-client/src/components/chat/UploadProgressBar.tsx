import { Text, View } from 'react-native';

import { useAppearanceStore } from '../../store/appearance.store';

export type UploadState = { label: string; progress: number | null };

/** The encrypt / upload / send progress of an attachment, above the composer. */
export default function UploadProgressBar({ state }: { state: UploadState }) {
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <View className={`mb-2.5 rounded-[20px] border border-border px-4 py-3 ${surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'}`}>
      <Text className="text-[12px] font-semibold uppercase tracking-[1px] text-primary">{state.label}</Text>
      <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-alt/70">
        <View className="h-full bg-primary" style={{ width: `${Math.round((state.progress ?? 0.05) * 100)}%` }} />
      </View>
    </View>
  );
}
