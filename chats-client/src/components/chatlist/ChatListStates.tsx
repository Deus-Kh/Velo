import { ActivityIndicator, Text, View } from 'react-native';

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

/** Placeholder rows while the first page of conversations loads. */
export function ChatListSkeleton({ compact }: { compact: boolean }) {
  const items = compact ? [0, 1, 2, 3] : [0, 1, 2];

  return (
    <View className="mt-4 px-4">
      {items.map((item) => (
        <View
          key={item}
          className={`mb-3 rounded-[22px] border border-border bg-surface-elevated ${
            compact ? 'p-3.5' : 'p-4'
          }`}
        >
          <View className="flex-row items-start">
            <View className={`mr-4 rounded-full bg-background-alt/80 ${compact ? 'h-12 w-12' : 'h-14 w-14'}`} />

            <View className="flex-1">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <View className="h-4 w-28 rounded-full bg-background-alt/80" />
                  <View className="mt-2 h-3.5 w-36 rounded-full bg-background-alt/65" />
                </View>
                <View className="h-3.5 w-12 rounded-full bg-background-alt/65" />
              </View>

              <View className={`h-3.5 rounded-full bg-background-alt/60 ${compact ? 'mt-3 w-[72%]' : 'mt-4 w-[76%]'}`} />

              <View className={`flex-row items-center justify-between ${compact ? 'mt-3' : 'mt-4'}`}>
                <View className="h-7 w-32 rounded-full bg-background-alt/75" />
                <View className="h-3.5 w-24 rounded-full bg-background-alt/60" />
              </View>
            </View>
          </View>
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
