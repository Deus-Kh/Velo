import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/** The chat list's empty states, with a title and one line of guidance. */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-elevated border border-border">
        <View className="h-6 w-6 rounded-full bg-primary/30" />
      </View>
      <Text className="mt-5 text-center text-xl font-semibold text-text">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-6 text-muted">{description}</Text>
    </View>
  );
}

/** Placeholder rows in the shape of the list row while the first page of conversations loads (B1). */
export function ChatListSkeleton({ compact }: { compact: boolean }) {
  const items = compact ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];

  return (
    <View className="mt-2">
      {items.map((item) => (
        <View key={item}>
          <View className={`flex-row items-center px-4 ${compact ? 'py-2' : 'py-3'}`}>
            <View className="mr-3 h-12 w-12 rounded-full bg-background-alt/80" />
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <View className="h-4 w-32 rounded-full bg-background-alt/80" />
                <View className="h-3 w-10 rounded-full bg-background-alt/65" />
              </View>
              <View className="mt-2.5 h-3.5 w-[70%] rounded-full bg-background-alt/60" />
            </View>
          </View>
          <View className="ml-[76px] bg-border" style={{ height: StyleSheet.hairlineWidth }} />
        </View>
      ))}
    </View>
  );
}

export function InlineSearchLoading() {
  return (
    <View className="mx-4 mt-4 flex-row items-center rounded-[18px] border border-border bg-surface-elevated px-4 py-3">
      <ActivityIndicator size="small" color="#2DD4BF" />
      <Text className="ml-3 text-sm text-muted">Searching encrypted contacts...</Text>
    </View>
  );
}
