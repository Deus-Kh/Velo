import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import {
  cancelVoiceRecording,
  ensureMicrophonePermission,
  formatDuration,
  hasMicrophonePermission,
  startVoiceRecording,
  stopVoiceRecording,
  type Recording,
  type RecorderTick,
} from '../shared/media/voiceNotes';

/**
 * T8.4: the composer row with a Telegram-style voice recorder. Wrap the
 * row's content (attach button, text input, and the send button while
 * there is text) in it; with `active` the microphone sits at the end.
 *
 *   hold the microphone   → recording starts at once; a timer, a pulsing dot
 *                           and "Slide to cancel" cover the input
 *   release               → stop and send (too short → a hint, nothing sent)
 *   slide left            → discard
 *   slide up              → lock: hands-free, with a live level meter, a
 *                           discard button and the microphone turned into Send
 *   first ever tap        → asks for the microphone permission and explains
 *
 * The recorder itself is the state machine in shared/media/voiceNotes.ts;
 * every gesture outcome maps to exactly one of its calls, so a release
 * that lands before the microphone is live still stops it.
 */
const CANCEL_DX = 110;
const LOCK_DY = 80;
const LIVE_BARS = 28;

type Phase = 'idle' | 'starting' | 'recording' | 'locked';

export default function VoiceComposer({
  active,
  disabled,
  sizeClass,
  surfaceClass,
  onRecorded,
  onError,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  sizeClass: string;
  surfaceClass: string;
  onRecorded: (r: Recording) => void;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [slot, setSlot] = useState({ width: 0, height: 0 });
  const slideX = useRef(new Animated.Value(0)).current;
  const micScale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const permissionRef = useRef<boolean | null>(null);

  const setPhaseBoth = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhase(p);
    },
    [setPhase],
  );

  useEffect(() => {
    hasMicrophonePermission().then((v) => {
      permissionRef.current = v;
    });
  }, []);

  useEffect(() => {
    if (phase === 'idle') {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const reset = useCallback(() => {
    setPhaseBoth('idle');
    setElapsed(0);
    setLevels([]);
    Animated.spring(micScale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
    Animated.timing(slideX, { toValue: 0, duration: 120, useNativeDriver: true }).start();
  }, [micScale, setPhaseBoth, slideX]);

  const begin = useCallback(async () => {
    if (disabled || phaseRef.current !== 'idle') return;
    if (permissionRef.current !== true) {
      const ok = await ensureMicrophonePermission();
      permissionRef.current = ok;
      onError(ok ? 'Hold the microphone to record, release to send' : 'Microphone permission is needed for voice messages');
      return;
    }
    setPhaseBoth('starting');
    setElapsed(0);
    setLevels([]);
    slideX.setValue(0);
    Animated.spring(micScale, { toValue: 1.35, useNativeDriver: true, friction: 5 }).start();
    try {
      await startVoiceRecording((t: RecorderTick) => {
        setElapsed(t.elapsedMs);
        setLevels((prev) => {
          const next = prev.length >= LIVE_BARS ? prev.slice(1) : prev.slice();
          next.push(t.amplitude);
          return next;
        });
      });
      // the ref is mutated by setPhaseBoth during the await; TypeScript narrowed it to 'idle' above
      if ((phaseRef.current as Phase) === 'starting') setPhaseBoth('recording');
    } catch (e: any) {
      reset();
      onError(e?.message || 'Could not start recording');
    }
  }, [disabled, micScale, onError, reset, setPhaseBoth, slideX]);

  const finish = useCallback(async () => {
    if (phaseRef.current === 'idle') return;
    reset();
    try {
      const r = await stopVoiceRecording();
      if (r) onRecorded(r);
      else onError('Hold the microphone a little longer to record a voice message');
    } catch (e: any) {
      onError(e?.message || 'Could not save the recording');
    }
  }, [onError, onRecorded, reset]);

  const discard = useCallback(async () => {
    if (phaseRef.current === 'idle') return;
    reset();
    await cancelVoiceRecording().catch(() => undefined);
  }, [reset]);

  const lock = useCallback(() => {
    setPhaseBoth('locked');
    slideX.setValue(0);
    Animated.spring(micScale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  }, [micScale, setPhaseBoth, slideX]);

  // The responder is created once; it reads the latest handlers through a ref.
  const handlers = useRef({ begin, finish, discard, lock });
  handlers.current = { begin, finish, discard, lock };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        handlers.current.begin();
      },
      onPanResponderMove: (_e, g) => {
        const p = phaseRef.current;
        if (p !== 'starting' && p !== 'recording') return;
        if (g.dx < -CANCEL_DX) {
          handlers.current.discard();
          return;
        }
        if (g.dy < -LOCK_DY) {
          handlers.current.lock();
          return;
        }
        slideX.setValue(Math.min(0, g.dx));
      },
      onPanResponderRelease: () => {
        const p = phaseRef.current;
        if (p === 'starting' || p === 'recording') handlers.current.finish();
      },
      onPanResponderTerminate: () => {
        const p = phaseRef.current;
        if (p === 'starting' || p === 'recording') handlers.current.finish();
      },
    }),
  ).current;

  const onSlotLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== slot.width || height !== slot.height) setSlot({ width, height });
  };

  const recording = phase !== 'idle';
  const hintOpacity = slideX.interpolate({ inputRange: [-CANCEL_DX, -CANCEL_DX / 3, 0], outputRange: [0, 0.6, 1], extrapolate: 'clamp' });

  return (
    <View className="relative">
      <View className="flex-row items-center gap-2.5">
        {children}
        {active ? (
          phase === 'locked' ? (
            <Pressable
              onPress={finish}
              onLayout={onSlotLayout}
              accessibilityLabel="Send the voice message"
              className={`${sizeClass} items-center justify-center rounded-full bg-primary active:opacity-80`}
            >
              <Icon lib="Lucide" name="send" size={20} color={colors.background} />
            </Pressable>
          ) : (
            <Animated.View {...pan.panHandlers} onLayout={onSlotLayout} style={{ transform: [{ scale: micScale }] }}>
              <View
                accessibilityLabel="Hold to record a voice message"
                accessibilityRole="button"
                className={`${sizeClass} items-center justify-center rounded-full ${recording ? 'bg-danger' : `border border-border ${surfaceClass}`}`}
              >
                <Icon lib="Lucide" name="mic" size={20} color={recording ? '#FFFFFF' : colors.text} />
              </View>
            </Animated.View>
          )
        ) : null}
      </View>

      {recording ? (
        <View
          pointerEvents={phase === 'locked' ? 'auto' : 'box-only'}
          className="absolute inset-y-0 left-0 flex-row items-center rounded-[24px] bg-background"
          style={{ right: slot.width + 10 }}
        >
          {phase === 'locked' ? (
            <>
              <Pressable onPress={discard} accessibilityLabel="Discard the recording" className="h-11 w-11 items-center justify-center rounded-full bg-danger/15 active:opacity-80">
                <Icon lib="Lucide" name="trash-2" size={20} color={colors.danger} />
              </Pressable>
              <View className="mx-3 h-11 flex-1 flex-row items-center justify-end overflow-hidden rounded-[22px] border border-border bg-surface-elevated px-3">
                {Array.from({ length: LIVE_BARS }, (_, i) => {
                  const v = levels[levels.length - LIVE_BARS + i] ?? 0;
                  return <View key={i} style={[styles.liveBar, { height: 4 + Math.round(v * 22), backgroundColor: colors.primary }]} />;
                })}
              </View>
              <Text className="w-12 text-right text-[15px] font-semibold tabular-nums text-text">{formatDuration(elapsed)}</Text>
            </>
          ) : (
            <>
              <Animated.View style={[styles.dot, { opacity: pulse, backgroundColor: colors.danger }]} />
              <Text className="ml-2 w-12 text-[15px] font-semibold tabular-nums text-text">{formatDuration(elapsed)}</Text>
              <Animated.View style={[styles.hint, { opacity: hintOpacity, transform: [{ translateX: slideX }] }]}>
                <Icon lib="Lucide" name="chevron-left" size={18} color={colors.muted} />
                <Text className="ml-0.5 text-[14px] text-muted">Slide to cancel</Text>
              </Animated.View>
            </>
          )}
        </View>
      ) : null}

      {phase === 'starting' || phase === 'recording' ? (
        <View pointerEvents="none" style={[styles.lockHint, { width: slot.width, bottom: slot.height + 10 }]}>
          <View className="items-center rounded-full border border-border bg-surface-elevated px-2 py-1.5">
            <Icon lib="Lucide" name="lock" size={14} color={colors.muted} />
            <Icon lib="Lucide" name="chevron-up" size={12} color={colors.muted} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { marginLeft: 6, width: 12, height: 12, borderRadius: 6 },
  hint: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  liveBar: { width: 3, marginLeft: 2, borderRadius: 2 },
  lockHint: { position: 'absolute', right: 0, alignItems: 'center' },
});
