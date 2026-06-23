import { Pressable, Text } from 'react-native';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
}: Props) {
  const base = 'w-full rounded-[18px] items-center justify-center py-3.5 active:opacity-80';
  const styles =
    variant === 'primary'
      ? disabled
        ? 'bg-surface border border-border'
        : 'bg-primary'
      : 'bg-surface border border-border';

  return (
    <Pressable disabled={disabled} onPress={onPress} className={`${base} ${styles}`}>
      <Text className={`font-semibold ${disabled ? 'text-muted' : variant === 'primary' ? 'text-background' : 'text-text'}`}>
        {title}
      </Text>
    </Pressable>
  );
}
