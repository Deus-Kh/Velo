import { Pressable, Text, View } from 'react-native';

/**
 * A notice above the message list: a changed safety number, a session that
 * needs a reset, a degraded session, or being offline.
 */
export default function InlineChatNotice({
  title,
  body,
  tone,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  body: string;
  tone: 'warning' | 'info' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  // 'danger' is the security-warning class (spec §8.3): it must not look like a technical error.
  const toneClasses =
    tone === 'danger'
      ? 'border-danger/50 bg-danger/10'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10'
        : 'border-border bg-surface-elevated/88';
  const titleTone = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text';

  return (
    <View className={`mx-3 mb-2 rounded-[20px] border px-4 py-3 ${toneClasses}`}>
      <Text className={`text-sm font-semibold ${titleTone}`}>{title}</Text>
      <Text className="mt-1 text-[13px] leading-5 text-muted">{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          className="mt-3 self-start rounded-full border border-border bg-background-alt/60 px-3.5 py-2 active:opacity-80"
        >
          <Text className="text-[13px] font-semibold text-text">{actionLabel}</Text>
        </Pressable>
      ) : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <Pressable
          onPress={onSecondaryAction}
          className="mt-2 self-start rounded-full border border-border bg-background-alt/60 px-3.5 py-2 active:opacity-80"
        >
          <Text className="text-[13px] font-semibold text-text">{secondaryActionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
