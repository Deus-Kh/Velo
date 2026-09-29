import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { protocolErrorCode } from '@velo/protocol';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { AUTO_DOWNLOAD_BYTES, downloadAttachment } from '../shared/media/attachments';
import { hasMedia } from '../shared/media/mediaStore';
import {
  currentPlayback,
  formatDuration,
  nextPlaybackSpeed,
  playbackSpeed,
  playVoiceNote,
  seekPlayback,
  setPlaybackSpeed,
  subscribeToPlayback,
  togglePlayback,
  type PlaybackSpeed,
} from '../shared/media/voiceNotes';
import { decodeWaveform, placeholderWaveform } from '../shared/media/waveform';
import { presentProtocolError } from '../shared/chat/protocolErrors';
import type { AttachmentMeta } from '../shared/storage/messageStore';

/**
 * T8.4: a voice note inside a bubble, Telegram-style: a round play/pause
 * button, the waveform (from the message, or a stable placeholder for
 * notes sent without one) that fills as the note plays and seeks on tap,
 * the elapsed / total time, and a speed toggle while playing.
 *
 * The buttons are gesture-handler Pressables: every bubble sits inside the
 * swipe-to-reply Swipeable, whose gesture detector swallows the taps of
 * nested React Native Pressables on Android (taps on the note did
 * nothing, while taps on plain text bubbles reached the bubble itself).
 */
const BARS = 40;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const WAVE_HEIGHT = 28;
const NOTE_WIDTH = 236;

type Playback = { state: 'idle' | 'playing' | 'paused'; positionMs: number; durationMs: number };

export default function VoiceNoteView({ myUserId, meta, mine }: { myUserId: string; meta: AttachmentMeta; mine: boolean }) {
  const colors = useThemeColors();
  const [local, setLocal] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; warning: boolean } | null>(null);
  const [playback, setPlayback] = useState<Playback>(() => {
    const c = currentPlayback();
    return c && c.blobId === meta.blobId ? { state: c.state, positionMs: c.positionMs, durationMs: c.durationMs } : { state: 'idle', positionMs: 0, durationMs: meta.durationMs ?? 0 };
  });
  const [speed, setSpeed] = useState<PlaybackSpeed>(playbackSpeed());
  const [waveWidth, setWaveWidth] = useState(0);
  const startedRef = useRef(false);
  const heights = useMemo(() => decodeWaveform(meta.waveform, BARS) ?? placeholderWaveform(meta.blobId, BARS), [meta.waveform, meta.blobId]);
  const duration = playback.durationMs > 0 ? playback.durationMs : (meta.durationMs ?? 0);

  useEffect(() => {
    let cancelled = false;
    hasMedia(myUserId, meta.blobId).then((v) => {
      if (cancelled) return;
      setLocal(v);
      if (!v && meta.size <= AUTO_DOWNLOAD_BYTES) download();
    });
    const unsub = subscribeToPlayback((e) => {
      if (e.blobId !== meta.blobId) {
        setPlayback((prev) => (prev.state === 'idle' ? prev : { state: 'idle', positionMs: 0, durationMs: prev.durationMs }));
        return;
      }
      if (e.state === 'ended') setPlayback((prev) => ({ state: 'idle', positionMs: 0, durationMs: e.durationMs > 0 ? e.durationMs : prev.durationMs }));
      else setPlayback({ state: e.state, positionMs: e.positionMs, durationMs: e.durationMs });
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.blobId, myUserId]);

  const download = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setDownloading(0);
    try {
      await downloadAttachment({ myUserId, meta, onProgress: (l, t) => setDownloading(t > 0 ? l / t : 0) });
      setLocal(true);
    } catch (e) {
      const code = protocolErrorCode(e);
      const p = code ? presentProtocolError(code) : null;
      setError({ text: p?.userMessage ?? 'Download failed. Tap to retry.', warning: Boolean(p?.securityWarning) });
      startedRef.current = false;
    } finally {
      setDownloading(null);
    }
  };

  const onMainPress = async () => {
    if (!local) {
      if (downloading === null) download();
      return;
    }
    setError(null);
    try {
      await togglePlayback(myUserId, meta);
    } catch (e: any) {
      setError({ text: e?.message || 'Could not play', warning: false });
    }
  };

  const onSeek = async (e: { nativeEvent: { locationX?: number } }) => {
    if (!local || waveWidth <= 0 || duration <= 0) return;
    const x = e.nativeEvent.locationX ?? 0;
    const fraction = Math.max(0, Math.min(1, x / waveWidth));
    setError(null);
    try {
      if (playback.state === 'idle') await playVoiceNote(myUserId, meta, { startMs: fraction * duration });
      else await seekPlayback({ fraction });
    } catch (err: any) {
      setError({ text: err?.message || 'Could not play', warning: false });
    }
  };

  const onSpeed = async () => {
    const next = nextPlaybackSpeed(speed);
    setSpeed(next);
    await setPlaybackSpeed(next);
  };

  const onWaveLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== waveWidth) setWaveWidth(w);
  };

  const fill = duration > 0 ? Math.min(1, playback.positionMs / duration) : 0;
  const active = playback.state !== 'idle';
  const barColor = mine ? colors.background : colors.primary;
  const label = error
    ? error.text
    : downloading !== null
      ? `Decrypting… ${Math.round(downloading * 100)}%`
      : active
        ? `${formatDuration(playback.positionMs)} / ${formatDuration(duration)}`
        : `${formatDuration(duration)}${local === false ? ' · tap to download' : ''}`;
  const labelTone = error?.warning ? 'text-danger' : mine ? 'text-background/80' : 'text-muted';
  const icon = !local ? 'download' : playback.state === 'playing' ? 'pause' : 'play';

  return (
    <View className="mb-1 flex-row items-center" style={{ width: NOTE_WIDTH }}>
      <Pressable
        onPress={onMainPress}
        accessibilityLabel={!local ? 'Download the voice message' : playback.state === 'playing' ? 'Pause' : 'Play the voice message'}
        hitSlop={6}
      >
        <View className={`h-11 w-11 items-center justify-center rounded-full ${mine ? 'bg-background' : 'bg-primary'}`}>
          {downloading !== null ? (
            <Text className={`text-[14px] font-semibold ${mine ? 'text-primary' : 'text-background'}`}>…</Text>
          ) : (
            <Icon lib="Lucide" name={icon} size={20} color={mine ? colors.primary : colors.background} />
          )}
        </View>
      </Pressable>

      <View className="ml-3 flex-1">
        <Pressable onPress={onSeek} disabled={!local} accessibilityLabel="Seek inside the voice message">
          <View className="flex-row items-end" style={{ height: WAVE_HEIGHT }} onLayout={onWaveLayout}>
            {heights.map((h, i) => {
              const played = fill > 0 && i / BARS < fill;
              const dynamic = { height: Math.max(3, Math.round(h * WAVE_HEIGHT)), backgroundColor: barColor, opacity: played ? 1 : active ? 0.35 : 0.55 };
              return <View key={i} style={[i < BARS - 1 ? styles.bar : styles.lastBar, dynamic]} />;
            })}
          </View>
        </Pressable>
        <View className="mt-1 flex-row items-center">
          <Text className={`text-[12px] tabular-nums ${labelTone}`} numberOfLines={1}>
            {label}
          </Text>
          {active ? (
            <Pressable onPress={onSpeed} accessibilityLabel="Playback speed" hitSlop={6}>
              <View className={`ml-2 rounded-full px-1.5 py-0.5 ${mine ? 'bg-background/20' : 'bg-primary/15'}`}>
                <Text className={`text-[11px] font-semibold ${mine ? 'text-background' : 'text-primary'}`}>{`${speed}x`}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: BAR_WIDTH, borderRadius: 2, marginRight: BAR_GAP },
  lastBar: { width: BAR_WIDTH, borderRadius: 2 },
});
