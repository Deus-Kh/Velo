import Avatar from '../Avatar';
import ListRow from '../ListRow';
import type { GroupView } from '../../shared/api/groups.api';
import { formatConversationTime } from '../../shared/chat/conversationList';

/** One group on the chat list (B1): name and time, then the preview or the member count. */
export default function GroupRow({ group, preview, onPress }: { group: GroupView; preview: string; onPress: () => void }) {
  return (
    <ListRow
      avatar={<Avatar name={group.name || '?'} size="list" />}
      title={group.name}
      meta={group.lastMessageAt > 0 ? formatConversationTime(group.lastMessageAt) : undefined}
      subtitle={preview || `${group.members.length} member${group.members.length === 1 ? '' : 's'}`}
      onPress={onPress}
    />
  );
}
