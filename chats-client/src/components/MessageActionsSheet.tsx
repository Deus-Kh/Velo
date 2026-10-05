import { Pressable, Text, View } from 'react-native';

import BottomSheetPanel, { BottomSheetAction } from './BottomSheetPanel';

/** T7.2: the long-press sheet shared by the 1:1 and group chats. */
export const QUICK_REACTIONS = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

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

      {onReply && !deleted ? <BottomSheetAction icon="corner-up-left" label="Reply" onPress={onReply} /> : null}
      {!deleted ? <BottomSheetAction icon="copy" label="Copy" onPress={onCopy} /> : null}
      {!deleted && !failed ? <BottomSheetAction icon="forward" label="Forward" onPress={onForward} /> : null}
      {mine && onEdit && !deleted && !failed ? <BottomSheetAction icon="pencil" label="Edit" onPress={onEdit} /> : null}
      {mine && failed && onRetry ? <BottomSheetAction icon="refresh-cw" label="Retry send" tone="warning" onPress={onRetry} /> : null}
      <BottomSheetAction icon="trash-2" label="Delete for me" onPress={onDeleteForMe} />
      {mine && onDeleteForEveryone && !deleted && !failed ? (
        <BottomSheetAction icon="trash-2" label="Delete for everyone" tone="danger" onPress={onDeleteForEveryone} />
      ) : null}
      <BottomSheetAction icon="x" label="Cancel" onPress={onClose} />
    </BottomSheetPanel>
  );
}
