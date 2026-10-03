import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { protocolErrorCode } from '@velo/protocol';
import { AUTO_DOWNLOAD_BYTES, downloadAttachment, isImage } from '../shared/media/attachments';
import { cachedMediaDataUri, mediaDataUri } from '../shared/media/mediaStore';
import type { AttachmentMeta } from '../shared/storage/messageStore';
import { presentProtocolError } from '../shared/chat/protocolErrors';
import VoiceNoteView from './VoiceNoteView';
import { isAudio } from '../shared/media/attachments';

/**
 * T8.3: an attachment inside a bubble. On the device: shown. Not yet:
 * a placeholder with the dimensions, downloaded at once when small, on tap
 * otherwise; every integrity failure is shown in the security-warning tone.
 */
/** B3: a photo bubble is at most ~75 % of the screen (the bubble's own padding is inside that), never edge to edge. */
const MAX_W_CAP = 300;
const MAX_H = 320;
const BUBBLE_MAX_FRACTION = 0.75;
const BUBBLE_PADDING = 32;

export function photoMaxWidth(windowWidth: number): number {
  return Math.min(MAX_W_CAP, Math.max(160, Math.floor(windowWidth * BUBBLE_MAX_FRACTION) - BUBBLE_PADDING));
}

export function frameFor(meta: AttachmentMeta, maxWidth: number): { width: number; height: number } {
  const w = meta.width && meta.width > 0 ? meta.width : 4;
  const h = meta.height && meta.height > 0 ? meta.height : 3;
  const scale = Math.min(maxWidth / w, MAX_H / h, 1e9);
  const width = Math.max(120, Math.round(w * scale));
  const height = Math.max(90, Math.round(h * scale));
  return { width: Math.min(width, maxWidth), height: Math.min(height, MAX_H) };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentView(props: { myUserId: string; meta: AttachmentMeta; mine: boolean; onOpen?: (uri: string) => void; trailing?: React.ReactNode }) {
  if (isAudio(props.meta)) return <VoiceNoteView myUserId={props.myUserId} meta={props.meta} mine={props.mine} trailing={props.trailing} />; // T8.4
  return <ImageAttachment {...props} />;
}

function ImageAttachment({ myUserId, meta, mine, onOpen }: { myUserId: string; meta: AttachmentMeta; mine: boolean; onOpen?: (uri: string) => void }) {
  // An own photo (or one shown earlier in this process) renders at once from the cache; otherwise
  // the placeholder shows the dimensions and size, and offers a download only once the file
  // check has said the photo is not on the device (A2).
  const [uri, setUri] = useState<string | null>(() => cachedMediaDataUri(meta.blobId));
  const [checked, setChecked] = useState<boolean>(() => cachedMediaDataUri(meta.blobId) !== null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; warning: boolean } | null>(null);
  const startedRef = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const frame = frameFor(meta, photoMaxWidth(windowWidth));

  const download = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setProgress(0);
    try {
      await downloadAttachment({ myUserId, meta, onProgress: (loaded, total) => setProgress(total > 0 ? loaded / total : 0) });
      const u = await mediaDataUri(myUserId, meta.blobId, meta.contentType);
      setUri(u);
    } catch (e) {
      const code = protocolErrorCode(e);
      const p = code ? presentProtocolError(code) : null;
      setError({ text: p?.userMessage ?? 'Download failed. Tap to retry.', warning: Boolean(p?.securityWarning) });
      startedRef.current = false;
    } finally {
      setProgress(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await mediaDataUri(myUserId, meta.blobId, meta.contentType);
      if (cancelled) return;
      setChecked(true);
      if (local) setUri(local);
      else if (meta.size <= AUTO_DOWNLOAD_BYTES) download();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.blobId, myUserId]);

  if (uri && isImage(meta)) {
    return (
      <Pressable onPress={() => onOpen?.(uri)} accessibilityLabel="Open the photo" className="mb-1 overflow-hidden rounded-[14px]" style={{ width: frame.width, height: frame.height }}>
        <Image source={{ uri }} style={{ width: frame.width, height: frame.height }} resizeMode="cover" accessibilityLabel="Photo" />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        if (checked && progress === null && !uri) download();
      }}
      accessibilityLabel="Download the attachment"
      className={`mb-1 items-center justify-center rounded-[14px] ${mine ? 'bg-bubble-out-text/10' : 'bg-text/10'}`}
      style={{ width: frame.width, height: Math.min(frame.height, 160) }}
    >
      {progress !== null ? (
        <>
          <Text className={`text-[13px] ${mine ? 'text-bubble-out-text' : 'text-text'}`}>{`Decrypting… ${Math.round(progress * 100)}%`}</Text>
          <View className="mt-2 h-1.5 w-2/3 overflow-hidden rounded-full bg-text/15">
            <View className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </View>
        </>
      ) : error ? (
        <Text className={`px-3 text-center text-[12px] ${error.warning ? 'text-danger' : mine ? 'text-bubble-out-text' : 'text-muted'}`}>{error.text}</Text>
      ) : (
        <>
          <Text className={`text-[13px] font-semibold ${mine ? 'text-bubble-out-text' : 'text-text'}`}>{isImage(meta) ? 'Photo' : meta.name || 'File'}</Text>
          <Text className={`mt-1 text-[12px] ${mine ? 'text-bubble-out-muted' : 'text-muted'}`}>{checked ? `${formatBytes(meta.size)} · tap to download` : formatBytes(meta.size)}</Text>
        </>
      )}
    </Pressable>
  );
}
