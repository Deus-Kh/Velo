import { useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { cancelVoiceRecording, ensureMicrophonePermission, formatDuration, startVoiceRecording, stopVoiceRecording, type Recording } from '../shared/media/voiceNotes';

/**
 * T8.4: hold to record a voice note, release to send; a release before the
 * minimum length cancels. Errors are reported through `onError`.
 */
export default function RecordButton({ disabled, sizeClass, surfaceClass, onRecorded, onError }: { disabled?: boolean; sizeClass: string; surfaceClass: string; onRecorded: (r: Recording) => void; onError: (message: string) => void }) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const activeRef = useRef(false);

  const start = async () => {
    if (disabled || activeRef.current) return;
    if (!(await ensureMicrophonePermission())) {
      onError('Microphone permission is needed for voice messages');
      return;
    }
    activeRef.current = true;
    setElapsed(0);
    try {
      await startVoiceRecording((ms) => setElapsed(ms));
    } catch (e: any) {
      activeRef.current = false;
      setElapsed(null);
      onError(e?.message || 'Could not start recording');
    }
  };

  const finish = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setElapsed(null);
    try {
      const r = await stopVoiceRecording();
      if (r) onRecorded(r);
    } catch (e: any) {
      onError(e?.message || 'Could not save the recording');
    }
  };

  return (
    <Pressable
      onPressIn={start}
      onPressOut={finish}
      onLongPress={() => undefined}
      delayLongPress={200}
      disabled={disabled}
      accessibilityLabel="Hold to record a voice message"
      className={`${sizeClass} items-center justify-center rounded-full border ${elapsed !== null ? 'border-danger bg-danger/20' : `border-border ${surfaceClass}`} active:opacity-80`}
    >
      <Text className={`text-[13px] font-semibold ${elapsed !== null ? 'text-danger' : 'text-text'}`}>{elapsed !== null ? formatDuration(elapsed) : '\u{1F3A4}'}</Text>
    </Pressable>
  );
}

export { cancelVoiceRecording };
