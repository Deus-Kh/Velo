import { Pressable, Text, View } from 'react-native';

/** The row that opens the archived list, revealed by pulling the home list down. */
export default function ArchivedRow({
  count,
  unreadCount,
  compact,
  onPress,
}: {
  count: number;
  unreadCount: number;
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mx-4 mt-4 flex-row items-center rounded-[18px] border border-border bg-surface-elevated active:opacity-80 ${
        compact ? 'px-3 py-2.5' : 'px-3.5 py-3'
      }`}
    >
      <View className={`mr-3 items-center justify-center rounded-full border border-border bg-background-alt/70 ${compact ? 'h-9 w-9' : 'h-10 w-10'}`}>
        <Text className="text-[16px] text-muted">⌄</Text>
      </View>

      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-text">Archived</Text>
        <Text className="mt-0.5 text-[12px] text-muted">
          {count} chat{count === 1 ? '' : 's'} stored outside the main list
        </Text>
      </View>

      <View className="items-end">
        {unreadCount > 0 ? (
          <View className="min-w-6 rounded-full bg-primary px-2 py-[5px]">
            <Text className="text-center text-xs font-semibold text-background">
              {unreadCount}
            </Text>
          </View>
        ) : (
          <Text className="text-[12px] font-medium text-muted">Open</Text>
        )}
      </View>
    </Pressable>
  );
}
