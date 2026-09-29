import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ProfileAvatar } from '@velo/protocol';

import Avatar from './Avatar';
import BottomSheetPanel from './BottomSheetPanel';
import { AVATAR_COLORS, AVATAR_EMOJIS } from '../shared/chat/profile';
import type { StoredProfile } from '../shared/storage/profileStore';

/** T7.7: edit the profile contacts see: a display name and an emoji-on-colour avatar. */
export default function ProfileSheet({ current, fallbackName, onSave, onClose, busy, error }: { current: StoredProfile | null; fallbackName: string; onSave: (name: string, avatar: ProfileAvatar | null) => void; onClose: () => void; busy?: boolean; error?: string | null }) {
  const [name, setName] = useState(current?.name ?? fallbackName);
  const initial = current?.avatar?.kind === 'emoji' ? current.avatar : null;
  const [emoji, setEmoji] = useState<string | null>(initial?.emoji ?? null);
  const [color, setColor] = useState<string>(initial?.color ?? AVATAR_COLORS[0]!);
  const preview: StoredProfile = { name: name.trim() || fallbackName, avatar: emoji ? { kind: 'emoji', emoji, color } : current?.avatar?.kind === 'jpeg' ? current.avatar : null, updatedAt: 0 };

  return (
    <BottomSheetPanel title="Your profile" onClose={onClose}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">Contacts receive this over your encrypted session with them. The server never stores it.</Text>
      <View className="flex-row items-center px-3">
        <Avatar name={preview.name} profile={preview} size="xl" className="mr-4" />
        <View className="flex-1 rounded-[16px] border border-border bg-surface/92 px-4">
          <TextInput value={name} onChangeText={setName} placeholder="Display name" placeholderTextColor="#94A3B8" maxLength={64} className="py-3 text-[15px] text-text" />
        </View>
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2 px-3">
        {AVATAR_EMOJIS.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e === emoji ? null : e)} className={`h-10 w-10 items-center justify-center rounded-full border ${e === emoji ? 'border-primary bg-primary/15' : 'border-border bg-surface/80'} active:opacity-80`}>
            <Text className="text-[20px]">{e}</Text>
          </Pressable>
        ))}
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2 px-3">
        {AVATAR_COLORS.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} className={`h-8 w-8 rounded-full border-2 ${c === color ? 'border-text' : 'border-transparent'} active:opacity-80`} style={{ backgroundColor: c }} />
        ))}
      </View>
      {error ? <Text className="mt-2 px-3 text-xs text-danger">{error}</Text> : null}
      <View className="mt-3 flex-row gap-2">
        <Pressable onPress={onClose} className="flex-1 items-center rounded-[16px] border border-border py-3 active:opacity-80">
          <Text className="font-semibold text-text">Cancel</Text>
        </Pressable>
        <Pressable disabled={busy || name.trim().length === 0} onPress={() => onSave(name.trim(), emoji ? { kind: 'emoji', emoji, color } : null)} className={`flex-1 items-center rounded-[16px] py-3 active:opacity-80 ${name.trim() ? 'bg-primary' : 'border border-border bg-surface'}`}>
          <Text className={`font-semibold ${name.trim() ? 'text-background' : 'text-muted'}`}>{busy ? 'Saving…' : 'Save and share'}</Text>
        </Pressable>
      </View>
    </BottomSheetPanel>
  );
}
