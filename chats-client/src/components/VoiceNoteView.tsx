import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { protocolErrorCode } from '@velo/protocol';
import { downloadAttachment, AUTO_DOWNLOAD_BYTES } from '../shared/media/attachments';
import { hasMedia } from '../shared/media/mediaStore';
import { currentlyPlaying, formatDuration, playVoiceNote, stopPlayback, subscribeToPlayback } from '../shared/media/voiceNotes';
import { presentProtocolError } from '../shared/chat/protocolErrors';
import type { AttachmentMeta } from '../shared/storage/messageStore';

const voiceNoteStyle = { width: 220 };

/** T8.4: a voice note inside a bubble: download if needed, play/stop, duration and a progress bar. */
export default function VoiceNoteView({ myUserId, meta, mine }: { myUserId: string; meta: AttachmentMeta; mine: boolean }) {
  const [local, setLocal] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; warning: boolean } | null>(null);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(currentlyPlaying() === meta.blobId);
  const startedRef = useRef(false);
  const duration = meta.durationMs ?? 0;

  useEffect(() => {
    let cancelled = false;
    hasMedia(myUserId, meta.blobId).then((v) => {
      if (cancelled) return;
      setLocal(v);
      if (!v && meta.size <= AUTO_DOWNLOAD_BYTES) download();
    });
    const unsub = subscribeToPlayback((e) => {
      if (e.blobId !== meta.blobId) {
        setIsPlaying(false);
        return;
      }
      setIsPlaying(!e.ended);
      setPosition(e.ended ? 0 : e.positionMs);
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

  const toggle = async () => {
    if (!local) {
      if (downloading === null) download();
      return;
    }
    try {
      if (isPlaying) await stopPlayback();
      else await playVoiceNote(myUserId, meta);
    } catch (e: any) {
      setError({ text: e?.message || 'Could not play', warning: false });
    }
  };

  const tone = mine ? 'text-background' : 'text-text';
  const fill = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <Pressable onPress={toggle} className={`mb-1 flex-row items-center rounded-[14px] px-3 py-2 ${mine ? 'bg-white/15' : 'bg-black/10'}`} style={voiceNoteStyle}>
      <View className={`mr-3 h-9 w-9 items-center justify-center rounded-full ${mine ? 'bg-white/30' : 'bg-primary/20'}`}>
        <Text className={`text-[16px] ${tone}`}>{downloading !== null ? '…' : isPlaying ? '■' : '▶'}</Text>
      </View>
      <View className="flex-1">
        <View className="h-1.5 overflow-hidden rounded-full bg-black/20">
          <View className="h-full bg-primary" style={{ width: `${Math.round((downloading !== null ? downloading : fill) * 100)}%` }} />
        </View>
        <Text className={`mt-1 text-[11px] ${mine ? 'text-background/75' : 'text-muted'}`}>
          {error ? error.text : downloading !== null ? 'Decrypting…' : `${formatDuration(isPlaying ? position : duration)}${local === false ? ' · tap to download' : ''}`}
        </Text>
      </View>
    </Pressable>
  );
}
