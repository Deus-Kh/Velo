import { Pressable, Text, View } from 'react-native';

import type { SearchHit } from '../../shared/storage/messageStore';
import { formatConversationTime } from '../../shared/chat/conversationList';
import { useAppearanceStore } from '../../store/appearance.store';

/** T7.8: a message found on this device, in the search results. */
export default function MessageHitRow({ title, hit, onPress }: { title: string; hit: SearchHit; onPress: () => void }) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
        surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
      } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-base font-semibold text-text" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs font-medium text-muted">{formatConversationTime(hit.message.createdAt)}</Text>
      </View>
      <Text className="mt-1 text-sm leading-6 text-muted" numberOfLines={2}>
        {hit.snippet}
      </Text>
    </Pressable>
  );
}
