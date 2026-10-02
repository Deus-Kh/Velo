import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { protocolErrorCode } from '@velo/protocol';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import {
  AUTO_DOWNLOAD_BYTES,
  downloadAttachment,
} from '../shared/media/attachments';
import { hasMedia, isKnownLocal } from '../shared/media/mediaStore';
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
 * Plain React Native Pressables: nested inside the bubble's own Pressable
 * the innermost one takes the tap, so the message actions do not open on
 * a play. (The taps that "did nothing" on the first device run were eaten
 * by the invisible back-swipe strip in MainTabsScreen, not by the bubble.)
 */
/** Bars are fitted to the measured width (3 dp bar, 2 dp gap); 40 is the pre-layout guess. */
const DEFAULT_BARS = 40;
const MIN_BARS = 16;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const WAVE_HEIGHT = 28;
/** The note fills the bubble: at most 80 % of the screen less the bubble's horizontal padding. */
const NOTE_MAX_WIDTH = 300;
const NOTE_MIN_WIDTH = 200;
// MessageBubble is max-w-[80%] of the message row, which sits inside the list's px-3; its own px-4 is inside the 80 %.
const LIST_HORIZONTAL_PADDING = 24;
const BUBBLE_MAX_FRACTION = 0.8;
const BUBBLE_PADDING = 32;

type Playback = {
  state: 'idle' | 'playing' | 'paused';
  positionMs: number;
  durationMs: number;
};

export default function VoiceNoteView({
  myUserId,
  meta,
  mine,
  trailing,
}: {
  myUserId: string;
  meta: AttachmentMeta;
  mine: boolean;
  /** The message time and status, placed at the end of the duration line (MessageBubble passes it). */
  trailing?: ReactNode;
}) {
  const colors = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const noteWidth = Math.min(
    NOTE_MAX_WIDTH,
    Math.max(
      NOTE_MIN_WIDTH,
      Math.floor(
        (windowWidth - LIST_HORIZONTAL_PADDING) * BUBBLE_MAX_FRACTION,
      ) -
        BUBBLE_PADDING -
        1,
    ),
  );
  // null = not checked yet. An own upload or a blob seen earlier in this process starts as local (A2).
  const [local, setLocal] = useState<boolean | null>(() => (isKnownLocal(myUserId, meta.blobId) ? true : null));
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; warning: boolean } | null>(
    null,
  );
  const [playback, setPlayback] = useState<Playback>(() => {
    const c = currentPlayback();
    return c && c.blobId === meta.blobId
      ? { state: c.state, positionMs: c.positionMs, durationMs: c.durationMs }
      : { state: 'idle', positionMs: 0, durationMs: meta.durationMs ?? 0 };
  });
  const [speed, setSpeed] = useState<PlaybackSpeed>(playbackSpeed());
  const [waveWidth, setWaveWidth] = useState(0);
  const startedRef = useRef(false);
  const bars =
    waveWidth > 0
      ? Math.max(
          MIN_BARS,
          Math.floor((waveWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)),
        )
      : DEFAULT_BARS;
  const heights = useMemo(
    () =>
      decodeWaveform(meta.waveform, bars) ??
      placeholderWaveform(meta.blobId, bars),
    [meta.waveform, meta.blobId, bars],
  );
  const duration =
    playback.durationMs > 0 ? playback.durationMs : meta.durationMs ?? 0;

  useEffect(() => {
    let cancelled = false;
    hasMedia(myUserId, meta.blobId).then(v => {
      if (cancelled) return;
      setLocal(v);
      if (!v && meta.size <= AUTO_DOWNLOAD_BYTES) download();
    });
    const unsub = subscribeToPlayback(e => {
      if (e.blobId !== meta.blobId) {
        setPlayback(prev =>
          prev.state === 'idle'
            ? prev
            : { state: 'idle', positionMs: 0, durationMs: prev.durationMs },
        );
        return;
      }
      if (e.state === 'ended')
        setPlayback(prev => ({
          state: 'idle',
          positionMs: 0,
          durationMs: e.durationMs > 0 ? e.durationMs : prev.durationMs,
        }));
      else
        setPlayback({
          state: e.state,
          positionMs: e.positionMs,
          durationMs: e.durationMs,
        });
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
      await downloadAttachment({
        myUserId,
        meta,
        onProgress: (l, t) => setDownloading(t > 0 ? l / t : 0),
      });
      setLocal(true);
    } catch (e) {
      const code = protocolErrorCode(e);
      const p = code ? presentProtocolError(code) : null;
      setError({
        text: p?.userMessage ?? 'Download failed. Tap to retry.',
        warning: Boolean(p?.securityWarning),
      });
      startedRef.current = false;
    } finally {
      setDownloading(null);
    }
  };

  const onMainPress = async () => {
    if (local !== true) {
      // a tap while the check is still running does nothing; only a confirmed "not here" downloads
      if (local === false && downloading === null) download();
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
      if (playback.state === 'idle')
        await playVoiceNote(myUserId, meta, { startMs: fraction * duration });
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
    : `${formatDuration(duration)}${
        local === false ? ' · tap to download' : ''
      }`;
  const labelTone = error?.warning
    ? 'text-danger'
    : mine
    ? 'text-background/80'
    : 'text-muted';
  const checking = local === null && downloading === null;
  const icon = local === false
    ? 'download'
    : playback.state === 'playing'
    ? 'pause'
    : 'play';

  return (
    <View className="flex-row items-center" style={{ width: noteWidth }}>
      <Pressable
        onPress={onMainPress}
        accessibilityLabel={
          local === false
            ? 'Download the voice message'
            : checking
            ? 'Checking the voice message'
            : playback.state === 'playing'
            ? 'Pause'
            : 'Play the voice message'
        }
        disabled={checking}
        hitSlop={6}
      >
        <View
          className={`h-11 w-11 items-center justify-center rounded-full ${
            mine ? 'bg-background' : 'bg-primary'
          }`}
          style={checking ? styles.checking : undefined}
        >
          {downloading !== null ? (
            <Text
              className={`text-[14px] font-semibold ${
                mine ? 'text-primary' : 'text-background'
              }`}
            >
              …
            </Text>
          ) : (
            <Icon
              lib="Lucide"
              name={icon}
              size={20}
              color={mine ? colors.primary : colors.background}
            />
          )}
        </View>
      </Pressable>

      <View className="ml-3 flex-1">
        <View className="flex-row items-end">
          {/*
            The Pressable owns the width (flex-1, may shrink) and the bars fill it
            absolutely, so the bars never dictate the row's width: before the first
            layout the default bar count would otherwise set an intrinsic width the
            row cannot shrink from, pushing the speed pill past the bubble's edge.
            pointerEvents none: the tap must target the Pressable itself, so that
            locationX is measured from its left edge and not from the 3 px bar.
          */}
          <Pressable
            onPress={onSeek}
            disabled={!local}
            accessibilityLabel="Seek inside the voice message"
            onLayout={onWaveLayout}
            className="min-w-0 flex-1 shrink"
            style={{ height: WAVE_HEIGHT }}
          >
            <View
              pointerEvents="none"
              className="absolute inset-0 flex-row items-end overflow-hidden"
            >
              {heights.map((h, i) => {
                const played = fill > 0 && i / bars < fill;
                const dynamic = {
                  height: Math.max(3, Math.round(h * WAVE_HEIGHT)),
                  backgroundColor: barColor,
                  opacity: played ? 1 : active ? 0.35 : 0.55,
                };
                return (
                  <View
                    key={i}
                    style={[
                      i < bars - 1 ? styles.bar : styles.lastBar,
                      dynamic,
                    ]}
                  />
                );
              })}
            </View>
          </Pressable>
          {active ? (
            <Pressable
              onPress={onSpeed}
              accessibilityLabel="Playback speed"
              accessibilityRole="button"
              hitSlop={8}
            >
              <View
                className={`ml-2 h-7 min-w-[44px] items-center justify-center rounded-full px-2.5 ${
                  mine ? 'bg-background/20' : 'bg-primary/15'
                }`}
              >
                <Text
                  className={`text-[13px] font-bold ${
                    mine ? 'text-background' : 'text-primary'
                  }`}
                >{`${speed}×`}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
        <View className="mt-1 flex-row items-center justify-between">
          <Text
            className={`shrink text-[12px] tabular-nums ${labelTone}`}
            numberOfLines={1}
          >
            {label}
          </Text>
          {trailing ? <View className="pl-2">{trailing}</View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  checking: { opacity: 0.45 },
  bar: { width: BAR_WIDTH, borderRadius: 2, marginRight: BAR_GAP },
  lastBar: { width: BAR_WIDTH, borderRadius: 2 },
});
