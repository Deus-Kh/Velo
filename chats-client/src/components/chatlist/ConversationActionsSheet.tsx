import { Pressable, Text, View } from 'react-native';

import BottomSheetPanel from '../BottomSheetPanel';
import { formatHandle } from '../../shared/utils/identity';

/** C1: the long-press sheet of a conversation row: pin, archive, block, mark as read. */
export default function ConversationActionsSheet({
  peerUsername,
  unreadCount,
  pinned,
  archived,
  blocked,
  onTogglePin,
  onToggleArchive,
  onToggleBlock,
  onMarkAsRead,
  onClose,
}: {
  peerUsername: string;
  unreadCount: number;
  pinned: boolean;
  archived: boolean;
  blocked: boolean;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleBlock: () => void;
  onMarkAsRead: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheetPanel title="Conversation Actions" onClose={onClose}>
      <View className="rounded-[18px] bg-background-alt/55 px-3 py-3">
        <Text className="text-[15px] font-medium text-text">
          {peerUsername}
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          {formatHandle(peerUsername)}
        </Text>
      </View>

      <Pressable
        onPress={() => {
          onTogglePin();
          onClose();
        }}
        className="mt-2 rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">
          {pinned ? 'Unpin conversation' : 'Pin conversation'}
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          Keep this chat at the top of the list for faster access.
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onToggleArchive();
          onClose();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">
          {archived ? 'Unarchive conversation' : 'Archive conversation'}
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          {archived
            ? 'Return this chat to the main conversation list.'
            : 'Move this chat out of the main list without deleting it.'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onToggleBlock();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className={`text-[15px] font-medium ${blocked ? 'text-text' : 'text-danger'}`}>
          {blocked ? 'Unblock contact' : 'Block contact'}
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          {blocked
            ? 'Messages, presence and typing flow again.'
            : 'They can no longer message you or see you; they are not told. History stays on this device.'}
        </Text>
      </Pressable>

      {unreadCount > 0 ? (
        <Pressable
          onPress={onMarkAsRead}
          className="rounded-[18px] px-3 py-3 active:opacity-80"
        >
          <Text className="text-[15px] font-medium text-text">Mark as read</Text>
          <Text className="mt-1 text-[13px] leading-5 text-muted">
            Clear unread state for this conversation on this device.
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onClose}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Cancel</Text>
      </Pressable>
    </BottomSheetPanel>
  );
}
