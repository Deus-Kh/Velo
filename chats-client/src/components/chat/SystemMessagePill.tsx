import { Text, View } from 'react-native';

/** A centred pill in the message list for a system line (timer changes, membership). */
export default function SystemMessagePill({ text }: { text: string }) {
  return (
    <View className="mb-3 items-center">
      <View className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5">
        <Text className="text-xs font-medium text-primary">{text}</Text>
      </View>
    </View>
  );
}
