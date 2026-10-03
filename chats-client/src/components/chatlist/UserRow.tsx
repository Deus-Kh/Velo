import Avatar from '../Avatar';
import ListRow from '../ListRow';
import type { UserListItem } from '../../shared/api/user.api';
import { shortSecureId } from '../../shared/utils/identity';
import type { StoredProfile } from '../../shared/storage/profileStore';

/** A directory contact in the search results, with no conversation yet (B1). */
export default function UserRow({ user, profile, onPress }: { user: UserListItem; profile: StoredProfile | null; onPress: () => void }) {
  const noKey = !user.hasPublicKey;

  return (
    <ListRow
      avatar={<Avatar name={user.username || '?'} profile={profile} size="list" />}
      title={user.username}
      subtitle={noKey ? 'No encryption key yet' : shortSecureId(user.userId)}
      subtitleTone={noKey ? 'warning' : 'muted'}
      subtitleIcon={noKey ? 'key-round' : undefined}
      onPress={onPress}
    />
  );
}
