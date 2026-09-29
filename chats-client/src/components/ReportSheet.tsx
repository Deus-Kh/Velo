import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import type { ReportReason } from '../shared/api/blocks.api';

const REASONS: Array<{ key: ReportReason; label: string }> = [
  { key: 'spam', label: 'Spam' },
  { key: 'abuse', label: 'Abuse or harassment' },
  { key: 'impersonation', label: 'Impersonation' },
  { key: 'other', label: 'Something else' },
];

/** T7.5: report a user. Only what is typed here leaves the device; messages stay encrypted. */
export default function ReportSheet({ name, onSubmit, onClose, busy }: { name: string; onSubmit: (reason: ReportReason, excerpt: string) => void; onClose: () => void; busy?: boolean }) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [excerpt, setExcerpt] = useState('');
  return (
    <BottomSheetPanel title={`Report ${name}`} onClose={onClose}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">
        Your messages stay end-to-end encrypted: the server receives only the reason and what you write below.
      </Text>
      {REASONS.map((r) => {
        const active = r.key === reason;
        return (
          <Pressable key={r.key} onPress={() => setReason(r.key)} className={`flex-row items-center rounded-[18px] px-3 py-2.5 active:opacity-80 ${active ? 'bg-primary/10' : ''}`}>
            <Text className={`flex-1 text-[15px] font-medium ${active ? 'text-primary' : 'text-text'}`}>{r.label}</Text>
            {active ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
          </Pressable>
        );
      })}
      <View className="mt-2 rounded-[16px] border border-border bg-surface/92 px-4">
        <TextInput
          value={excerpt}
          onChangeText={setExcerpt}
          placeholder="What happened? (optional, up to 2000 characters)"
          placeholderTextColor="#94A3B8"
          multiline
          maxLength={2000}
          className="min-h-[64px] py-3 text-[15px] text-text"
          textAlignVertical="top"
        />
      </View>
      <View className="mt-3 flex-row gap-2">
        <Pressable onPress={onClose} className="flex-1 items-center rounded-[16px] border border-border py-3 active:opacity-80">
          <Text className="font-semibold text-text">Cancel</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => onSubmit(reason, excerpt)} className="flex-1 items-center rounded-[16px] bg-danger py-3 active:opacity-80">
          <Text className="font-semibold text-background">{busy ? 'Sending…' : 'Send report'}</Text>
        </Pressable>
      </View>
    </BottomSheetPanel>
  );
}
