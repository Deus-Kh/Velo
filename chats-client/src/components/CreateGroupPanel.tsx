import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import { groupsApi, type GroupView } from '../shared/api/groups.api';
import { userApi, type UserListItem } from '../shared/api/user.api';

/**
 * T6.4: create a group: a name and at least one other member. The server
 * makes the creator admin (T6.3); the group screen then distributes the
 * creator's sender key to every member over the pairwise sessions.
 */
export default function CreateGroupPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (group: GroupView) => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserListItem[]>([]);
  const [selected, setSelected] = useState<UserListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await userApi.getUsers({ q, limit: 20 });
        setResults(res.data.items);
      } catch (e: any) {
        setError(e?.message || 'Search failed');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const toggle = (u: UserListItem) => {
    setSelected((prev) => (prev.some((s) => s.userId === u.userId) ? prev.filter((s) => s.userId !== u.userId) : [...prev, u]));
  };

  const canCreate = name.trim().length > 0 && selected.length > 0 && !creating;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const res = await groupsApi.create({ name: name.trim(), memberIds: selected.map((s) => s.userId) });
      onCreated(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not create the group');
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheetPanel title="New group" onClose={onClose}>
      <View className="rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor="#94A3B8"
          maxLength={64}
          className="py-3 text-[15px] text-text"
        />
      </View>

      {selected.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {selected.map((u) => (
            <Pressable key={u.userId} onPress={() => toggle(u)} className="rounded-full border border-primary/30 bg-primary/12 px-3 py-1 active:opacity-80">
              <Text className="text-xs font-semibold text-primary">{u.username} ×</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="mt-2 rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Add members by username"
          placeholderTextColor="#94A3B8"
          autoCapitalize="none"
          className="py-3 text-[15px] text-text"
        />
      </View>

      <View className="mt-2 max-h-56">
        <FlatList
          data={results}
          keyExtractor={(u) => u.userId}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text className="px-1 py-2 text-xs text-muted">{query.trim().length < 2 ? 'Type at least two characters to search.' : 'No contacts found.'}</Text>
          }
          renderItem={({ item }) => {
            const picked = selected.some((s) => s.userId === item.userId);
            return (
              <Pressable disabled={!item.hasPublicKey} onPress={() => toggle(item)} className="flex-row items-center py-2 active:opacity-80">
                <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                  <Text className="text-sm font-semibold text-primary">{item.username.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-text">{item.username}</Text>
                  <Text className="text-xs text-muted">{item.hasPublicKey ? 'Ready for E2EE' : 'No public key yet'}</Text>
                </View>
                <Text className={`text-xs font-semibold ${picked ? 'text-primary' : 'text-muted'}`}>{picked ? 'Selected' : 'Select'}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {error ? <Text className="mt-2 px-1 text-xs text-danger">{error}</Text> : null}

      <Pressable onPress={create} disabled={!canCreate} className={`mt-3 items-center rounded-[16px] py-3 active:opacity-80 ${canCreate ? 'bg-primary' : 'border border-border bg-surface'}`}>
        <Text className={`font-semibold ${canCreate ? 'text-background' : 'text-muted'}`}>{creating ? 'Creating…' : `Create group${selected.length ? ` (${selected.length + 1})` : ''}`}</Text>
      </Pressable>
    </BottomSheetPanel>
  );
}
