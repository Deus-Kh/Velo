import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';

/** T7.6: the last confirmation before an account is deleted: the password, once more. */
export default function DeleteAccountSheet({ onConfirm, onClose, busy, error }: { onConfirm: (password: string) => void; onClose: () => void; busy?: boolean; error?: string | null }) {
  const [password, setPassword] = useState('');
  return (
    <BottomSheetPanel title="Delete account" onClose={onClose}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">
        This removes your account, keys, undelivered messages, conversations and group memberships from the server, and erases everything stored on this device. Contacts see that the account is gone. It cannot be undone.
      </Text>
      <View className="rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput value={password} onChangeText={setPassword} placeholder="Your password" placeholderTextColor="#94A3B8" secureTextEntry autoCapitalize="none" className="py-3 text-[15px] text-text" />
      </View>
      {error ? <Text className="mt-2 px-3 text-xs text-danger">{error}</Text> : null}
      <View className="mt-3 flex-row gap-2">
        <Pressable onPress={onClose} className="flex-1 items-center rounded-[16px] border border-border py-3 active:opacity-80">
          <Text className="font-semibold text-text">Keep account</Text>
        </Pressable>
        <Pressable disabled={busy || password.length === 0} onPress={() => onConfirm(password)} className={`flex-1 items-center rounded-[16px] py-3 active:opacity-80 ${password.length ? 'bg-danger' : 'border border-border bg-surface'}`}>
          <Text className={`font-semibold ${password.length ? 'text-background' : 'text-muted'}`}>{busy ? 'Deleting…' : 'Delete forever'}</Text>
        </Pressable>
      </View>
    </BottomSheetPanel>
  );
}
