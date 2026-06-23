import { View, Text } from 'react-native';

export default function SectionEyebrow({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <View className={`${compact ? 'mb-2 mt-1 px-1' : 'mt-6 px-1'}`}>
      <Text className="text-[11px] font-semibold uppercase tracking-[1.3px] text-primary">
        {title}
      </Text>
      {description ? (
        <Text className="mt-1.5 text-[13px] leading-5 text-muted">{description}</Text>
      ) : null}
    </View>
  );
}
