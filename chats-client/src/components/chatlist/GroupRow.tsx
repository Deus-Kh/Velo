import { Pressable, Text, View } from 'react-native';

import type { GroupView } from '../../shared/api/groups.api';
import { formatConversationTime } from '../../shared/chat/conversationList';
import { useAppearanceStore } from '../../store/appearance.store';

/** One group on the chat list. */
export default function GroupRow({ group, preview, onPress }: { group: GroupView; preview: string; onPress: () => void }) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
        surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
      } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
    >
      <View className="flex-row items-center">
        <View className={`mr-4 items-center justify-center rounded-full bg-primary/15 ${
          interfaceDensity === 'compact' ? 'h-12 w-12' : 'h-14 w-14'
        }`}>
          <Text className="text-lg font-semibold text-primary">
            {(group.name || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-base font-semibold text-text" numberOfLines={1}>
              {group.name}
            </Text>
            {group.lastMessageAt > 0 ? (
              <Text className="text-xs font-medium text-muted">
                {formatConversationTime(group.lastMessageAt)}
              </Text>
            ) : null}
          </View>
          <Text className="mt-1 text-sm text-muted">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </Text>
          {preview ? (
            <Text numberOfLines={1} className="mt-1 text-sm text-muted">
              {preview}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
