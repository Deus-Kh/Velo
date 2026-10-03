import { Pressable, Text, View } from 'react-native';

import Avatar from '../Avatar';
import SecurityBadge from './SecurityBadge';
import type { ConversationListItem } from '../../shared/api/conversations.api';
import { formatConversationTime } from '../../shared/chat/conversationList';
import { formatHandle } from '../../shared/utils/identity';
import type { StoredProfile } from '../../shared/storage/profileStore';
import { useAppearanceStore } from '../../store/appearance.store';

/**
 * C1: one 1:1 conversation on the chat list. The same card serves the home
 * list (with a "Pinned" badge), the archived list and the search results.
 */
export default function ConversationRow({
  item,
  title,
  badge,
  profile,
  preview,
  showSecurityRow,
  onPress,
  onLongPress,
}: {
  item: ConversationListItem;
  title: string;
  badge: 'pinned' | 'archived' | 'existing' | null;
  profile: StoredProfile | null;
  preview: string;
  showSecurityRow: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`mb-3 rounded-[22px] border border-border active:opacity-80 ${
        surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
      } ${interfaceDensity === 'compact' ? 'p-3.5' : 'p-4'}`}
    >
      <View className="flex-row items-start">
        <Avatar name={item.peerUsername || '?'} profile={profile} size={interfaceDensity === 'compact' ? 'md' : 'lg'} className="mr-4" />

        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-base font-semibold text-text">{title}</Text>
                {badge === 'pinned' ? (
                  <View className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-primary">
                      Pinned
                    </Text>
                  </View>
                ) : badge ? (
                  <View className="rounded-full border border-border bg-background-alt/55 px-2 py-0.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-muted">
                      {badge === 'archived' ? 'Archived' : 'Existing'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-1 text-sm text-muted">{formatHandle(item.peerUsername)}</Text>
            </View>

            <View className="items-end">
              <Text className="text-xs font-medium text-muted">
                {formatConversationTime(item.lastMessageAt)}
              </Text>
              {item.unreadCount > 0 ? (
                <View className="mt-2 min-w-6 rounded-full bg-primary px-2 py-1">
                  <Text className="text-center text-xs font-semibold text-background">
                    {item.unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {preview ? (
            <Text
              numberOfLines={1}
              className={`text-sm leading-6 text-muted ${interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'}`}
            >
              {preview}
            </Text>
          ) : null}

          {showSecurityRow ? (
            <View
              className={`flex-row items-center justify-between ${
                interfaceDensity === 'compact' ? 'mt-2.5' : 'mt-3'
              }`}
            >
              <SecurityBadge
                ready={Boolean(item.peerHasPublicKey)}
                label={item.peerHasPublicKey ? 'Secure channel ready' : 'Public key missing'}
              />
              <Text className="text-xs font-medium text-muted">Open conversation</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
