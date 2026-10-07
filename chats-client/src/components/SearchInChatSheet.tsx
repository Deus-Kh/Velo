import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import { searchStoredMessages, type SearchHit } from '../shared/storage/messageStore';

/** T7.8: search this conversation's sealed local store; tap a hit to jump to it. */
export default function SearchInChatSheet({ myUserId, peerKey, senderName, onJump, onClose }: { myUserId: string; peerKey: string; senderName: (userId: string | null | undefined, mine: boolean) => string; onJump: (hit: SearchHit) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const focusedOnceRef = useRef(false);

  // A8: focus on the field's first layout, one frame later. `autoFocus` asked for the keyboard
  // before the sheet had a frame (the sheet then landed under it on a first open), and a focus
  // scheduled before the native view is attached raises no keyboard at all.
  const focusOnFirstLayout = () => {
    if (focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const r = await searchStoredMessages({ myUserId, peerUserId: peerKey, query: q, maxResults: 50 });
        if (!cancelled) setHits(r);
      } catch (e) {
        console.warn('[search] failed:', e);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [myUserId, peerKey, query]);

  return (
    <BottomSheetPanel title="Search in chat" onClose={onClose} scroll={false}>
      <View className="rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput ref={inputRef} onLayout={focusOnFirstLayout} value={query} onChangeText={setQuery} placeholder="Search messages on this device" placeholderTextColor="#94A3B8" autoCapitalize="none" returnKeyType="search" className="py-3 text-[15px] text-text" />
      </View>
      <View className="mt-2 max-h-80">
        <FlatList
          data={hits}
          keyExtractor={(h) => h.message.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text className="px-1 py-3 text-xs text-muted">{query.trim().length < 2 ? 'Type at least two characters.' : searching ? 'Searching…' : 'No message matches.'}</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => onJump(item)} className="rounded-[14px] px-2 py-2 active:opacity-80">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-primary">{senderName(item.message.senderUserId, item.message.direction === 'out')}</Text>
                <Text className="text-[11px] text-muted">{new Date(item.message.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
              </View>
              <Text className="mt-0.5 text-[13px] leading-5 text-text" numberOfLines={2}>
                {item.snippet}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </BottomSheetPanel>
  );
}
