import { Pressable, Text, View } from 'react-native';

import BottomSheetPanel from './BottomSheetPanel';
import { TIMER_OPTIONS } from '../shared/chat/disappearing';

/** T7.3: pick the disappearing-message timer for a conversation. */
export default function TimerSheet({ current, onPick, onClose, note }: { current: number | null; onPick: (seconds: number | null) => void; onClose: () => void; note?: string }) {
  return (
    <BottomSheetPanel title="Disappearing messages" onClose={onClose}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">
        {note ?? 'New messages disappear from both devices after the chosen time. The other side is told over the encrypted session; the server never learns the setting.'}
      </Text>
      {TIMER_OPTIONS.map((o) => {
        const active = o.seconds === current;
        return (
          <Pressable key={o.label} onPress={() => onPick(o.seconds)} className={`flex-row items-center rounded-[18px] px-3 py-3 active:opacity-80 ${active ? 'bg-primary/10' : ''}`}>
            <Text className={`flex-1 text-[15px] font-medium ${active ? 'text-primary' : 'text-text'}`}>{o.label}</Text>
            {active ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
          </Pressable>
        );
      })}
      <Pressable onPress={onClose} className="rounded-[18px] px-3 py-3 active:opacity-80">
        <Text className="text-[15px] font-medium text-text">Cancel</Text>
      </Pressable>
    </BottomSheetPanel>
  );
}
