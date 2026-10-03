import Avatar from '../Avatar';
import { Icon } from '../Icon';
import ListRow, { UnreadBadge } from '../ListRow';
import type { ConversationListItem } from '../../shared/api/conversations.api';
import { formatConversationTime } from '../../shared/chat/conversationList';
import { formatHandle } from '../../shared/utils/identity';
import type { StoredProfile } from '../../shared/storage/profileStore';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * One 1:1 conversation on the chat list (B1): name and time, then the
 * local preview (A1) with the unread count or a pin mark. Only exceptional
 * states replace the preview: a contact with no encryption key, a blocked
 * contact.
 */
export default function ConversationRow({
  item,
  title,
  profile,
  preview,
  pinned,
  blocked,
  onPress,
  onLongPress,
}: {
  item: ConversationListItem;
  title: string;
  profile: StoredProfile | null;
  preview: string;
  pinned: boolean;
  blocked: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const colors = useThemeColors();
  const exceptional = blocked
    ? { text: 'Blocked', tone: 'danger' as const, icon: 'ban' as const }
    : !item.peerHasPublicKey
      ? { text: 'No encryption key yet', tone: 'warning' as const, icon: 'key-round' as const }
      : null;

  return (
    <ListRow
      avatar={<Avatar name={item.peerUsername || '?'} profile={profile} size="list" />}
      title={title}
      meta={formatConversationTime(item.lastMessageAt)}
      subtitle={exceptional ? exceptional.text : preview || formatHandle(item.peerUsername)}
      subtitleTone={exceptional ? exceptional.tone : 'muted'}
      subtitleIcon={exceptional ? exceptional.icon : undefined}
      trailing={item.unreadCount > 0 ? <UnreadBadge count={item.unreadCount} /> : pinned ? <Icon lib="Lucide" name="pin" size={14} color={colors.muted} /> : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
}
