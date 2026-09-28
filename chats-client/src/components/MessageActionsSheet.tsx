import { Pressable, Text, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';

/** T7.2: the long-press sheet shared by the 1:1 and group chats. */
export const QUICK_REACTIONS = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

function Row({ title, subtitle, tone = 'text', onPress }: { title: string; subtitle?: string; tone?: 'text' | 'warning' | 'danger'; onPress: () => void }) {
  const titleTone = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text';
  return (
    <Pressable onPress={onPress} className="rounded-[18px] px-3 py-3 active:opacity-80">
      <Text className={`text-[15px] font-medium ${titleTone}`}>{title}</Text>
      {subtitle ? <Text className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</Text> : null}
    </Pressable>
  );
}

export default function MessageActionsSheet({
  snippet,
  mine,
  deleted,
  failed,
  myReaction,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onForward,
  onDeleteForMe,
  onDeleteForEveryone,
  onRetry,
  onClose,
}: {
  snippet: string;
  mine: boolean;
  deleted: boolean;
  failed?: boolean;
  myReaction?: string | null;
  onReact: (emoji: string, remove: boolean) => void;
  onReply?: () => void;
  onCopy: () => void;
  onEdit?: () => void;
  onForward: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone?: () => void;
  onRetry?: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheetPanel title="Message Actions" onClose={onClose}>
      <View className="rounded-[18px] bg-background-alt/55 px-3 py-3">
        <Text className="text-[13px] leading-5 text-muted">{deleted ? 'This message was deleted' : snippet}</Text>
      </View>

      {!deleted && !failed ? (
        <View className="mt-2 flex-row items-center justify-between px-1">
          {QUICK_REACTIONS.map((emoji) => {
            const active = myReaction === emoji;
            return (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji, active)}
                className={`h-11 w-11 items-center justify-center rounded-full border ${active ? 'border-primary/50 bg-primary/15' : 'border-border bg-surface/80'} active:opacity-80`}
              >
                <Text className="text-[22px]">{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {onReply && !deleted ? <Row title="Reply" subtitle="Quote this message in your next outgoing reply." onPress={onReply} /> : null}
      {!deleted ? <Row title="Copy" subtitle="Copy this message text to your clipboard." onPress={onCopy} /> : null}
      {!deleted && !failed ? <Row title="Forward" subtitle="Send this text to another chat. The recipient sees who wrote it and when." onPress={onForward} /> : null}
      {mine && onEdit && !deleted && !failed ? <Row title="Edit" subtitle="Change the text on every device that received it." onPress={onEdit} /> : null}
      {mine && failed && onRetry ? <Row title="Retry send" subtitle="Attempt to send this failed message again." tone="warning" onPress={onRetry} /> : null}
      <Row title="Delete for me" subtitle="Remove it from this device only." onPress={onDeleteForMe} />
      {mine && onDeleteForEveryone && !deleted && !failed ? (
        <Row title="Delete for everyone" subtitle="Asks the other side's devices to remove it. They honour the request, but the message may already have been read." tone="danger" onPress={onDeleteForEveryone} />
      ) : null}
      <Row title="Cancel" onPress={onClose} />
    </BottomSheetPanel>
  );
}
