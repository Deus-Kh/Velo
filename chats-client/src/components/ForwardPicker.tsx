import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import { conversationsApi } from '../shared/api/conversations.api';
import { groupsApi, type GroupView } from '../shared/api/groups.api';
import { useContactsStore } from '../store/contacts.store';
import type { ConversationTarget } from '../shared/chat/actions';

/** T7.2: choose where a forwarded message goes: a recent chat, a saved contact, or a group. */
type Row = { key: string; title: string; subtitle: string; target: ConversationTarget };

export default function ForwardPicker({ myUserId, excludePeerKey, onClose, onPick }: { myUserId: string; excludePeerKey?: string | null; onClose: () => void; onPick: (target: ConversationTarget) => void }) {
  const savedContactsByUser = useContactsStore((s) => s.savedContactsByUser);
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<Array<{ peerUserId: string; peerUsername: string }>>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, g] = await Promise.all([conversationsApi.list().catch(() => null), groupsApi.list().catch(() => null)]);
        if (cancelled) return;
        setConversations((c?.data.items ?? []).map((it) => ({ peerUserId: it.peerUserId, peerUsername: it.peerUsername })));
        setGroups(g?.data.items ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const g of groups) {
      const key = 'group:' + g.groupId;
      if (key === excludePeerKey) continue;
      seen.add(key);
      out.push({ key, title: g.name, subtitle: `${g.members.length} members · group`, target: { kind: 'group', group: g } });
    }
    for (const c of conversations) {
      if (c.peerUserId === excludePeerKey || seen.has(c.peerUserId)) continue;
      seen.add(c.peerUserId);
      out.push({ key: c.peerUserId, title: c.peerUsername || c.peerUserId, subtitle: 'Recent chat', target: { kind: 'peer', peerUserId: c.peerUserId } });
    }
    for (const s of savedContactsByUser[myUserId] ?? []) {
      if (s.peerUserId === excludePeerKey || seen.has(s.peerUserId)) continue;
      seen.add(s.peerUserId);
      out.push({ key: s.peerUserId, title: s.peerUsername || s.peerUserId, subtitle: 'Saved contact', target: { kind: 'peer', peerUserId: s.peerUserId } });
    }
    const q = query.trim().toLowerCase();
    return q ? out.filter((r) => r.title.toLowerCase().includes(q)) : out;
  }, [conversations, excludePeerKey, groups, myUserId, query, savedContactsByUser]);

  return (
    <BottomSheetPanel title="Forward to" onClose={onClose}>
      <View className="rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput value={query} onChangeText={setQuery} placeholder="Search chats and groups" placeholderTextColor="#94A3B8" autoCapitalize="none" className="py-3 text-[15px] text-text" />
      </View>
      <View className="mt-2 max-h-72">
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text className="px-1 py-3 text-xs text-muted">{loading ? 'Loading…' : 'No chat matches.'}</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item.target)} className="flex-row items-center py-2 active:opacity-80">
              <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                <Text className="text-sm font-semibold text-primary">{item.title.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-text" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-xs text-muted">{item.subtitle}</Text>
              </View>
              <Text className="text-xs font-semibold text-primary">Send</Text>
            </Pressable>
          )}
        />
      </View>
    </BottomSheetPanel>
  );
}
