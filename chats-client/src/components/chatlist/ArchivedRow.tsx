import { View } from 'react-native';

import { Icon } from '../Icon';
import ListRow, { UnreadBadge } from '../ListRow';
import { useThemeColors } from '../../theme/useThemeColors';

/** The row that opens the archived list, revealed by pulling the home list down (B1 row). */
export default function ArchivedRow({ count, unreadCount, onPress }: { count: number; unreadCount: number; onPress: () => void }) {
  const colors = useThemeColors();

  return (
    <ListRow
      avatar={
        <View className="h-12 w-12 items-center justify-center rounded-full bg-background-alt">
          <Icon lib="Lucide" name="archive" size={22} color={colors.muted} />
        </View>
      }
      title="Archived"
      subtitle={`${count} chat${count === 1 ? '' : 's'}`}
      trailing={unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : <Icon lib="Lucide" name="chevron-right" size={18} color={colors.muted} />}
      onPress={onPress}
      accessibilityLabel="Archived chats"
    />
  );
}
