import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import { blocksApi, type BlockedUser } from '../shared/api/blocks.api';
import { unblockPeer } from '../shared/chat/blocks';

/** T7.5: the account's block list, with unblock. */
export default function BlockedContactsSheet({ myUserId, onClose }: { myUserId: string; onClose: () => void }) {
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    blocksApi
      .list()
      .then((res) => {
        if (!cancelled) setItems(res.data.items);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || 'Could not load the list');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unblock = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      await unblockPeer(myUserId, userId);
      setItems((prev) => prev.filter((i) => i.userId !== userId));
    } catch (e: any) {
      setError(e?.message || 'Could not unblock');
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheetPanel title="Blocked contacts" onClose={onClose}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">Blocked contacts cannot message you, see your presence or typing, or reach you in groups. They are not told.</Text>
      <View className="max-h-72">
        <FlatList
          data={items}
          keyExtractor={(i) => i.userId}
          ListEmptyComponent={<Text className="px-3 py-3 text-xs text-muted">{loading ? 'Loading…' : 'Nobody is blocked.'}</Text>}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-3 py-2">
              <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                <Text className="text-sm font-semibold text-primary">{(item.username || '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text className="flex-1 text-sm font-semibold text-text" numberOfLines={1}>
                {item.username || item.userId}
              </Text>
              <Pressable disabled={busy !== null} onPress={() => unblock(item.userId)} className="rounded-full border border-border px-3 py-1 active:opacity-80">
                <Text className="text-xs font-semibold text-text">{busy === item.userId ? '…' : 'Unblock'}</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
      {error ? <Text className="mt-2 px-3 text-xs text-danger">{error}</Text> : null}
    </BottomSheetPanel>
  );
}
