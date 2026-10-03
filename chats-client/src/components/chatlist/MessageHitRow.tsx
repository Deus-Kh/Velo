import Avatar from '../Avatar';
import ListRow from '../ListRow';
import type { SearchHit } from '../../shared/storage/messageStore';
import { formatConversationTime } from '../../shared/chat/conversationList';
import type { StoredProfile } from '../../shared/storage/profileStore';

/** T7.8: a message found on this device, in the search results (B1 row). */
export default function MessageHitRow({ title, hit, profile, onPress }: { title: string; hit: SearchHit; profile: StoredProfile | null; onPress: () => void }) {
  return (
    <ListRow
      avatar={<Avatar name={title || '?'} profile={profile} size="list" />}
      title={title}
      meta={formatConversationTime(hit.message.createdAt)}
      subtitle={hit.snippet}
      subtitleLines={2}
      onPress={onPress}
    />
  );
}
